// ViceScaleMCPAdapter: ponto ÚNICO de acesso à ViceScale no Autopilot.
// A ViceScale é ferramenta de APOIO (headlines, frases, templates). O núcleo
// de proteções está em ../core/guarded-adapter.js; aqui ficam a camada de
// capacidades, a descoberta via tools/list, a ponte via sessão Claude e o
// monitoramento da conta.

import { readFileSync } from 'node:fs';
import { CAPABILITIES, UNAVAILABLE } from './capabilities.js';
import { GuardedAdapter } from '../core/guarded-adapter.js';
import { AuthError, CapabilityUnavailableError, ViceScaleError } from '../core/errors.js';
import { redact, redactString } from '../lib/redact.js';

export const loadCatalog = () => JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));

// Tetos diários internos. Os limites reais do plano "Vitalício" não são
// expostos pelo MCP; configuráveis via AUTOPILOT_QUOTAS_JSON.
export const DEFAULT_QUOTAS = { scrap: 60, downloads: 40, render: 24, ai: 120, repost: 20, publish: 20 };

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

export class ViceScaleMCPAdapter extends GuardedAdapter {
  constructor({ catalog = loadCatalog(), quotas = DEFAULT_QUOTAS, ...options }) {
    super({ name: 'vicescale', catalog, quotas, ...options });
  }

  isScheduled(tool, args) {
    return Boolean(args.agendarPara);
  }

  onSuccess(tool, result, latencyMs) {
    if (tool.name !== 'status') return;
    const parsed = parseAccountStatus(resultText(result));
    this.store.recordHealth({ ok: parsed.connected, latencyMs, detail: JSON.stringify(parsed) });
    if (parsed.connected) this.store.setSetting(this.key('auth_alert'), null);
  }

  onFailure(tool, error) {
    if (tool.name === 'status') this.store.recordHealth({ ok: false, detail: redact(error.message) });
  }

  // ---- capacidades ------------------------------------------------------

  listCapabilities() {
    return [
      ...Object.entries(CAPABILITIES).map(([name, c]) => {
        const tool = this.tool(c.tool);
        return { name, available: Boolean(tool), tool: c.tool, risk: tool?.risk ?? null };
      }),
      ...Object.entries(UNAVAILABLE).map(([name, u]) => ({ name, available: false, reason: u.reason, alternative: u.alternative })),
    ];
  }

  /** Executa uma capacidade estável (ver capabilities.js). */
  async run(capability, input = {}, options = {}) {
    const unavailable = UNAVAILABLE[capability];
    if (unavailable) {
      this.store.audit('capability_unavailable', { detail: { service: this.name, capability, reason: unavailable.reason } });
      throw new CapabilityUnavailableError(capability, unavailable);
    }
    const entry = CAPABILITIES[capability];
    if (!entry) throw new ViceScaleError(`Capacidade desconhecida: ${capability}`, { code: 'UNKNOWN_CAPABILITY' });
    return this.execute(entry.tool, entry.map(input), { ...options, capability });
  }

  // ---- descoberta -------------------------------------------------------

  /**
   * Consulta tools/list no servidor (quando o transporte permite) e compara com
   * o catálogo versionado. Diferenças de schema geram alerta.
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
    this.store.audit(drift ? 'discovery_drift' : 'discovery_ok', { detail: { service: this.name, added, removed, changed } });
    if (drift) this.store.setSetting(this.key('catalog_drift_alert'), { added, removed, changed });
    return { source: this.transport.kind, tools: remote.map((t) => t.name), added, removed, changed };
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
      this.recordFailure(tool, failure);
      return this.store.getOperation(operationId);
    }
    const result = { content: [{ type: 'text', text: redactString(text) }] };
    this.store.updateOperation(operationId, { state: 'completed', result, error: null });
    this.store.setSetting(this.key('last_success_at'), new Date().toISOString());
    this.onSuccess(tool, result, null);
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

  status() {
    return {
      ...super.status(),
      lastHealth: this.store.lastHealth(),
      catalogDriftAlert: this.store.getSetting(this.key('catalog_drift_alert')),
      pendingBridge: this.store.listOperations({ state: 'queued' }).length,
    };
  }
}
