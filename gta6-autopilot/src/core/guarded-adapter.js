// Núcleo compartilhado pelos adaptadores de serviços externos (ViceScale,
// Cut.Pro). Toda chamada passa por: validação contra o schema real do
// catálogo, travas de segurança (emergência, direitos de uso, publicação
// imediata, operações destrutivas), idempotência, dry-run, cotas diárias,
// retentativa segura e auditoria com redação de segredos.
//
// Riscos de operação:
//   read        consulta; repetível automaticamente
//   write       muda estado sem custo nem efeito público
//   quota       gasta créditos/cota ou cria job
//   publish     sai numa rede social
//   destructive apaga (inclusive conteúdo já publicado na rede)

import { validateToolInput } from './schema-validator.js';
import {
  AuthError,
  BlockedOperationError,
  DuplicateOperationError,
  QuotaExceededError,
  UnknownToolError,
  ValidationError,
} from './errors.js';
import { redact } from '../lib/redact.js';

const DRY_RUN_MODES = new Set(['off', 'publish', 'writes']);
const RISKS = new Set(['read', 'write', 'quota', 'publish', 'destructive']);

export class GuardedAdapter {
  /**
   * @param {object} options
   * @param {string} options.name prefixo das configurações/cotas deste serviço (ex.: "vicescale")
   * @param {'off'|'publish'|'writes'} [options.dryRun] publish = simula publicações e exclusões (padrão)
   */
  constructor({
    name,
    transport,
    store,
    catalog,
    dryRun = 'publish',
    quotas = {},
    retry = { attempts: 3, baseDelayMs: 500 },
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    if (!name || !transport || !store || !catalog) throw new Error('Adaptador exige name, transport, store e catalog.');
    if (!DRY_RUN_MODES.has(dryRun)) throw new Error(`dryRun inválido: ${dryRun}`);
    for (const tool of catalog.tools) {
      if (!RISKS.has(tool.risk)) throw new Error(`Risco desconhecido em ${tool.name}: ${tool.risk}`);
    }
    this.name = name;
    this.transport = transport;
    this.store = store;
    this.catalog = catalog;
    this.dryRun = dryRun;
    this.quotas = quotas;
    this.retry = retry;
    this.sleep = sleep;
    this.toolsByName = new Map(catalog.tools.map((t) => [t.name, t]));
  }

  // ---- extensão pelas subclasses ---------------------------------------

  /** A publicação tem horário futuro definido? */
  isScheduled() {
    return false;
  }

  onSuccess() {}

  onFailure() {}

  // ---- utilidades -------------------------------------------------------

  key(setting) {
    return `${this.name}:${setting}`;
  }

  tool(name) {
    return this.toolsByName.get(name) ?? null;
  }

  // ---- execução ---------------------------------------------------------

  /**
   * @returns {Promise<{ state: 'completed'|'queued'|'dry_run'|string, operation: object, reused?: boolean }>}
   */
  async execute(toolName, args = {}, { idempotencyKey, capability = null, context = {}, retryFailed = false } = {}) {
    const tool = this.tool(toolName);
    if (!tool) throw new UnknownToolError(toolName);

    const problems = validateToolInput(tool, args);
    if (tool.risk !== 'read' && !idempotencyKey) {
      problems.push('idempotencyKey obrigatório para operações que mudam estado, gastam cota ou publicam');
    }
    if (problems.length > 0) {
      this.store.audit('validation_failed', { tool: toolName, detail: { service: this.name, problems } });
      throw new ValidationError(toolName, problems);
    }

    this.#enforceGuards(tool, args, context);

    if (idempotencyKey) {
      const existing = this.store.findOperationByKey(idempotencyKey);
      if (existing) {
        if (existing.tool !== toolName) throw new DuplicateOperationError(idempotencyKey, `usada por ${existing.tool}`);
        if (existing.state === 'failed' && retryFailed) return this.#dispatch(tool, existing, { isRetry: true });
        if (existing.state === 'failed') throw new DuplicateOperationError(idempotencyKey, existing.state);
        this.store.audit('duplicate_suppressed', { tool: toolName, operationId: existing.id });
        return { state: existing.state, operation: existing, reused: true };
      }
    }

    if (this.#isDryRun(tool)) {
      const operation = this.store.createOperation({
        idempotencyKey,
        capability,
        tool: toolName,
        args,
        risk: tool.risk,
        state: 'dry_run',
      });
      this.store.updateOperation(operation.id, { result: { dryRun: true, wouldCall: { service: this.name, tool: toolName, args } } });
      this.store.audit('dry_run', { tool: toolName, operationId: operation.id, detail: redact(args) });
      return { state: 'dry_run', operation: this.store.getOperation(operation.id) };
    }

    this.#enforceQuota(tool);
    const operation = this.store.createOperation({
      idempotencyKey,
      capability,
      tool: toolName,
      args,
      risk: tool.risk,
      state: this.transport.deferred ? 'queued' : 'running',
    });
    if (tool.quotaBucket) this.store.incrementQuota(this.key(tool.quotaBucket));
    return this.#dispatch(tool, operation, { isRetry: false });
  }

  #isDryRun(tool) {
    if (this.dryRun === 'off' || tool.risk === 'read') return false;
    if (this.dryRun === 'writes') return true;
    return tool.risk === 'publish' || tool.risk === 'destructive';
  }

  #enforceGuards(tool, args, context) {
    if (tool.risk === 'publish' && this.store.getSetting('emergency_stop', false)) {
      this.#block(tool, 'emergency_stop', 'Botão de emergência ativo: todas as publicações estão suspensas.');
    }
    if ((tool.requiresRights || tool.risk === 'publish') && context.rightsCleared !== true) {
      this.#block(tool, 'rights_not_cleared', 'Bloqueado: material sem direitos de uso registrados (context.rightsCleared).');
    }
    if (tool.risk === 'publish' && !this.isScheduled(tool, args) && context.allowImmediate !== true) {
      this.#block(tool, 'immediate_publish', 'Publicação imediata bloqueada: agende um horário ou autorize explicitamente (context.allowImmediate).');
    }
    if (tool.risk === 'destructive' && context.confirmDestructive !== true) {
      this.#block(tool, 'destructive_unconfirmed', 'Operação destrutiva exige confirmação explícita (context.confirmDestructive).');
    }
  }

  #block(tool, reason, message) {
    this.store.audit('blocked', { tool: tool.name, detail: { service: this.name, reason } });
    throw new BlockedOperationError(message, reason);
  }

  #enforceQuota(tool) {
    const bucket = tool.quotaBucket;
    if (!bucket || this.quotas[bucket] === undefined) return;
    if (this.store.quotaUsed(this.key(bucket)) >= this.quotas[bucket]) {
      this.store.audit('quota_exceeded', { tool: tool.name, detail: { service: this.name, bucket, limit: this.quotas[bucket] } });
      throw new QuotaExceededError(bucket, this.quotas[bucket]);
    }
  }

  async #dispatch(tool, operation, { isRetry }) {
    if (this.transport.deferred) {
      if (isRetry) this.store.updateOperation(operation.id, { state: 'queued', error: null });
      this.store.audit('enqueued', { tool: tool.name, operationId: operation.id, detail: redact(operation.args) });
      return { state: 'queued', operation: this.store.getOperation(operation.id) };
    }

    // Só leituras são repetidas automaticamente: numa escrita, um erro de rede
    // não prova que a chamada não chegou ao servidor (risco de duplicar).
    const maxAttempts = tool.risk === 'read' ? this.retry.attempts : 1;
    this.store.audit('call_started', { tool: tool.name, operationId: operation.id, detail: redact(operation.args) });

    for (let attempt = 1; ; attempt += 1) {
      const started = Date.now();
      try {
        const result = await this.transport.callTool(tool.name, operation.args);
        const updated = this.store.updateOperation(operation.id, {
          state: 'completed',
          result: redact(result),
          error: null,
          incrementAttempts: true,
        });
        this.store.setSetting(this.key('last_success_at'), new Date().toISOString());
        this.onSuccess(tool, result, Date.now() - started);
        this.store.audit('call_completed', { tool: tool.name, operationId: operation.id, detail: { attempt } });
        return { state: 'completed', operation: updated };
      } catch (error) {
        const canRetry = error.retryable && attempt < maxAttempts;
        this.store.updateOperation(operation.id, {
          state: canRetry ? 'running' : 'failed',
          error: redact(error.message),
          incrementAttempts: true,
        });
        this.recordFailure(tool, error);
        if (!canRetry) throw error;
        const backoff = this.retry.baseDelayMs * 2 ** (attempt - 1);
        await this.sleep(Math.max(backoff, error.retryAfterMs ?? 0));
      }
    }
  }

  recordFailure(tool, error) {
    this.store.audit('call_failed', { tool: tool.name, detail: { service: this.name, code: error.code, message: redact(error.message) } });
    if (error instanceof AuthError) {
      this.store.setSetting(this.key('auth_alert'), { at: new Date().toISOString(), message: redact(error.message) });
    }
    this.onFailure(tool, error);
  }

  // ---- controle ---------------------------------------------------------

  /** Botão de emergência GLOBAL: vale para todos os serviços. */
  setEmergencyStop(active) {
    this.store.setSetting('emergency_stop', Boolean(active));
    this.store.audit(active ? 'emergency_stop_on' : 'emergency_stop_off', { detail: { via: this.name } });
  }

  quotaStatus() {
    return Object.fromEntries(
      Object.entries(this.quotas).map(([bucket, limit]) => [bucket, { used: this.store.quotaUsed(this.key(bucket)), limit }]),
    );
  }

  status() {
    return {
      service: this.name,
      transport: this.transport.kind,
      dryRun: this.dryRun,
      emergencyStop: this.store.getSetting('emergency_stop', false),
      lastSuccessAt: this.store.getSetting(this.key('last_success_at')),
      authAlert: this.store.getSetting(this.key('auth_alert')),
      catalogCapturedAt: this.catalog.capturedAt,
      toolCount: this.catalog.tools.length,
      quotas: this.quotaStatus(),
    };
  }
}
