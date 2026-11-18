// ViceScaleMCPAdapter: ponto ÚNICO de acesso à ViceScale no Autopilot.
//
// Responsabilidades: descoberta de ferramentas, execução, validação de
// parâmetros, tratamento de erros, alerta de autenticação, auditoria (com
// redação de segredos), retentativas seguras, idempotência/anti-duplicidade,
// cotas diárias, dry-run, botão de emergência e monitoramento de saúde.

import { readFileSync } from 'node:fs';
import { CAPABILITIES, UNAVAILABLE } from './capabilities.js';
import { validateToolInput } from './schema-validator.js';
import {
  AuthError,
  BlockedOperationError,
  CapabilityUnavailableError,
  DuplicateOperationError,
  QuotaExceededError,
  UnknownToolError,
  ValidationError,
  ViceScaleError,
} from './errors.js';
import { redact, redactString } from '../lib/redact.js';

export const loadCatalog = () => JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));

// Tetos diários internos. Os limites reais do plano "Vitalício" não são
// expostos pelo MCP; estes valores evitam consumo descontrolado e são
// configuráveis (AUTOPILOT_QUOTAS_JSON).
export const DEFAULT_QUOTAS = { scrap: 60, downloads: 40, render: 24, ai: 120, repost: 20, publish: 20 };

/** dryRun: 'off' | 'publish' (padrão: simula só publicações) | 'writes' (simula tudo que não é leitura). */
const DRY_RUN_MODES = new Set(['off', 'publish', 'writes']);

const stripDescriptions = (value) => {
  if (Array.isArray(value)) return value.map(stripDescriptions);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => k !== 'description' && k !== '$schema')
        .map(([k, v]) => [k, stripDescriptions(v)]),
    );
  }
  return value;
};

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
};

const schemaFingerprint = (schema) => JSON.stringify(sortKeys(stripDescriptions(schema ?? {})));

export const resultText = (result) =>
  (result?.content ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

/** Extrai o que interessa do texto de `status` sem guardar o e-mail da conta. */
export const parseAccountStatus = (text) => {
  const line = (label) => text.match(new RegExp(`^${label}:\\s*(.+)$`, 'mi'))?.[1]?.trim() ?? null;
  const networks = line('Redes conectadas');
  return {
    connected: /^Conectado ao ViceScale/im.test(text),
    plan: line('Plano'),
    scaleProjects: Number.parseInt(line('Projetos Scale') ?? '', 10) || 0,
    networks: networks && !/^nenhuma/i.test(networks) ? networks : null,
  };
};

export class ViceScaleMCPAdapter {
  constructor({
    transport,
    store,
    catalog = loadCatalog(),
    dryRun = 'publish',
    quotas = DEFAULT_QUOTAS,
    retry = { attempts: 3, baseDelayMs: 500 },
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }) {
    if (!transport || !store) throw new Error('ViceScaleMCPAdapter exige transport e store.');
    if (!DRY_RUN_MODES.has(dryRun)) throw new Error(`dryRun inválido: ${dryRun}`);
    this.transport = transport;
    this.store = store;
    this.catalog = catalog;
    this.dryRun = dryRun;
    this.quotas = quotas;
    this.retry = retry;
    this.sleep = sleep;
    this.toolsByName = new Map(catalog.tools.map((t) => [t.name, t]));
  }

  // ---- descoberta -------------------------------------------------------

  tool(name) {
    return this.toolsByName.get(name) ?? null;
  }

  listCapabilities() {
    return [
      ...Object.entries(CAPABILITIES).map(([name, c]) => {
        const tool = this.tool(c.tool);
        return { name, available: Boolean(tool), tool: c.tool, risk: tool?.risk ?? null };
      }),
      ...Object.entries(UNAVAILABLE).map(([name, u]) => ({ name, available: false, reason: u.reason, alternative: u.alternative })),
    ];
  }

  /**
   * Consulta tools/list no servidor (quando o transporte permite) e compara com
   * o catálogo versionado. Diferenças de schema geram alerta: o catálogo e a
   * camada de capacidades precisam ser revistos antes de seguir.
   */
  async discover() {
    const remote = await this.transport.listTools();
    if (!remote) {
      return {
        source: 'catalog',
        note: 'Transporte sem tools/list (ponte Claude). Descoberta feita dentro da sessão Claude; catálogo versionado em uso.',
        tools: this.catalog.tools.map((t) => t.name),
        added: [],
        removed: [],
        changed: [],
      };
    }
    const remoteByName = new Map(remote.map((t) => [t.name, t]));
    const added = remote.filter((t) => !this.toolsByName.has(t.name)).map((t) => t.name);
    const removed = this.catalog.tools.filter((t) => !remoteByName.has(t.name)).map((t) => t.name);
    const changed = this.catalog.tools
      .filter((t) => remoteByName.has(t.name))
      .filter((t) => schemaFingerprint(t.inputSchema) !== schemaFingerprint(remoteByName.get(t.name).inputSchema))
      .map((t) => t.name);

    this.store.saveCatalogSnapshot(this.transport.kind, remote);
    const drift = removed.length > 0 || changed.length > 0;
    this.store.audit(drift ? 'discovery_drift' : 'discovery_ok', { detail: { added, removed, changed } });
    if (drift) this.store.setSetting('catalog_drift_alert', { added, removed, changed });
    return { source: this.transport.kind, tools: remote.map((t) => t.name), added, removed, changed };
  }

  // ---- execução ---------------------------------------------------------

  /** Executa uma capacidade estável (ver capabilities.js). */
  async run(capability, input = {}, options = {}) {
    const unavailable = UNAVAILABLE[capability];
    if (unavailable) {
      this.store.audit('capability_unavailable', { detail: { capability, reason: unavailable.reason } });
      throw new CapabilityUnavailableError(capability, unavailable);
    }
    const entry = CAPABILITIES[capability];
    if (!entry) throw new ViceScaleError(`Capacidade desconhecida: ${capability}`, { code: 'UNKNOWN_CAPABILITY' });
    return this.execute(entry.tool, entry.map(input), { ...options, capability });
  }

  /**
   * @returns {{ state: 'completed'|'queued'|'dry_run', operation: object, reused?: boolean }}
   */
  async execute(toolName, args = {}, { idempotencyKey, capability = null, context = {}, retryFailed = false } = {}) {
    const tool = this.tool(toolName);
    if (!tool) throw new UnknownToolError(toolName);

    const problems = validateToolInput(tool, args);
    if (tool.risk !== 'read' && !idempotencyKey) problems.push('idempotencyKey obrigatório para operações que criam, gastam cota ou publicam');
    if (problems.length > 0) {
      this.store.audit('validation_failed', { tool: toolName, detail: { problems } });
      throw new ValidationError(toolName, problems);
    }

    this.#enforceGuards(tool, args, context);

    if (idempotencyKey) {
      const existing = this.store.findOperationByKey(idempotencyKey);
      if (existing) {
        if (existing.tool !== toolName) throw new DuplicateOperationError(idempotencyKey, `usada por ${existing.tool}`);
        if (existing.state === 'failed' && retryFailed) {
          return this.#dispatch(tool, existing, { isRetry: true });
        }
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
      const result = { dryRun: true, wouldCall: { tool: toolName, args } };
      this.store.updateOperation(operation.id, { result });
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
    if (tool.quotaBucket) this.store.incrementQuota(tool.quotaBucket);
    return this.#dispatch(tool, operation, { isRetry: false });
  }

  #isDryRun(tool) {
    if (this.dryRun === 'off' || tool.risk === 'read') return false;
    if (this.dryRun === 'writes') return true;
    return tool.risk === 'publish';
  }

  #enforceGuards(tool, args, context) {
    if (tool.risk !== 'publish') return;
    if (this.store.getSetting('emergency_stop', false)) {
      this.#block(tool, 'emergency_stop', 'Botão de emergência ativo: todas as publicações estão suspensas.');
    }
    if (context.rightsCleared !== true) {
      this.#block(tool, 'rights_not_cleared', 'Publicação bloqueada: material sem direitos de uso registrados (context.rightsCleared).');
    }
    if (!args.agendarPara && context.allowImmediate !== true) {
      this.#block(tool, 'immediate_publish', 'Publicação imediata bloqueada: informe agendarPara ou autorize explicitamente (context.allowImmediate).');
    }
  }

  #block(tool, reason, message) {
    this.store.audit('blocked', { tool: tool.name, detail: { reason } });
    throw new BlockedOperationError(message, reason);
  }

  #enforceQuota(tool) {
    const bucket = tool.quotaBucket;
    if (!bucket || this.quotas[bucket] === undefined) return;
    if (this.store.quotaUsed(bucket) >= this.quotas[bucket]) {
      this.store.audit('quota_exceeded', { tool: tool.name, detail: { bucket, limit: this.quotas[bucket] } });
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
        this.#afterSuccess(tool, result, Date.now() - started);
        this.store.audit('call_completed', { tool: tool.name, operationId: operation.id, detail: { attempt } });
        return { state: 'completed', operation: updated };
      } catch (error) {
        const canRetry = error.retryable && attempt < maxAttempts;
        this.store.updateOperation(operation.id, {
          state: canRetry ? 'running' : 'failed',
          error: redact(error.message),
          incrementAttempts: true,
        });
        this.#afterFailure(tool, error);
        if (!canRetry) throw error;
        await this.sleep(this.retry.baseDelayMs * 2 ** (attempt - 1));
      }
    }
  }

  #afterSuccess(tool, result, latencyMs) {
    this.store.setSetting('last_success_at', new Date().toISOString());
    if (tool.name === 'status') {
      const parsed = parseAccountStatus(resultText(result));
      this.store.recordHealth({ ok: parsed.connected, latencyMs, detail: JSON.stringify(parsed) });
      if (parsed.connected) this.store.setSetting('auth_alert', null);
    }
  }

  #afterFailure(tool, error) {
    this.store.audit('call_failed', { tool: tool.name, detail: { code: error.code, message: redact(error.message) } });
    if (error instanceof AuthError) {
      this.store.setSetting('auth_alert', { at: new Date().toISOString(), message: redact(error.message) });
    }
    if (tool.name === 'status') this.store.recordHealth({ ok: false, detail: redact(error.message) });
  }

  // ---- ponte Claude -----------------------------------------------------

  /** Entrega a próxima operação enfileirada para o worker da sessão Claude. */
  claimBridgedOperation() {
    const operation = this.store.claimNextQueued();
    if (operation) this.store.audit('bridge_claimed', { tool: operation.tool, operationId: operation.id });
    return operation;
  }

  /** Registra o resultado que o worker obteve ao chamar mcp__ViceScale__<tool>. */
  completeBridgedOperation(operationId, { text, error, authError = false }) {
    const operation = this.store.getOperation(operationId);
    if (!operation) throw new ViceScaleError(`Operação ${operationId} não encontrada.`, { code: 'NOT_FOUND' });
    if (operation.state !== 'dispatched') {
      throw new ViceScaleError(`Operação ${operationId} está em "${operation.state}", não em "dispatched".`, { code: 'BAD_STATE' });
    }
    const tool = this.tool(operation.tool);
    if (error) {
      const failure = authError ? new AuthError(error) : new ViceScaleError(error, { code: 'TOOL_ERROR' });
      this.store.updateOperation(operationId, { state: 'failed', error: redact(error) });
      this.#afterFailure(tool, failure);
      return this.store.getOperation(operationId);
    }
    const result = { content: [{ type: 'text', text: redactString(text) }] };
    this.store.updateOperation(operationId, { state: 'completed', result, error: null });
    this.#afterSuccess(tool, result, null);
    this.store.audit('bridge_completed', { tool: operation.tool, operationId });
    return this.store.getOperation(operationId);
  }

  // ---- monitoramento ----------------------------------------------------

  async checkHealth() {
    try {
      const outcome = await this.run('account.status');
      if (outcome.state === 'queued') return { state: 'queued', operationId: outcome.operation.id };
      return { state: 'completed', ...parseAccountStatus(resultText(outcome.operation.result)) };
    } catch (error) {
      return { state: 'failed', error: redact(error.message), code: error.code };
    }
  }

  setEmergencyStop(active) {
    this.store.setSetting('emergency_stop', Boolean(active));
    this.store.audit(active ? 'emergency_stop_on' : 'emergency_stop_off');
  }

  status() {
    const quotas = Object.fromEntries(
      Object.entries(this.quotas).map(([bucket, limit]) => [bucket, { used: this.store.quotaUsed(bucket), limit }]),
    );
    return {
      transport: this.transport.kind,
      dryRun: this.dryRun,
      emergencyStop: this.store.getSetting('emergency_stop', false),
      lastHealth: this.store.lastHealth(),
      lastSuccessAt: this.store.getSetting('last_success_at'),
      authAlert: this.store.getSetting('auth_alert'),
      catalogDriftAlert: this.store.getSetting('catalog_drift_alert'),
      catalogCapturedAt: this.catalog.capturedAt,
      toolCount: this.catalog.tools.length,
      pendingBridge: this.store.listOperations({ state: 'queued' }).length,
      quotas,
    };
  }
}
