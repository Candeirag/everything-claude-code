// CutProAdapter: ponto ÚNICO de acesso à Cut.Pro, a plataforma principal de
// cortes, render e publicação (TikTok + YouTube). Mesmo núcleo de proteções
// do adaptador ViceScale (../core/guarded-adapter.js).

import { readFileSync } from 'node:fs';
import { CAPABILITIES, UNAVAILABLE } from './capabilities.js';
import { GuardedAdapter } from '../core/guarded-adapter.js';
import { CapabilityUnavailableError, ViceScaleError } from '../core/errors.js';
import { redact } from '../lib/redact.js';

export const loadCutProCatalog = () => JSON.parse(readFileSync(new URL('./catalog.json', import.meta.url), 'utf8'));

// Tetos diários internos (além dos limites do plano, que a API impõe e
// informa). 8 vídeos/dia em 2 redes = 16 itens de post.
export const DEFAULT_CUTPRO_QUOTAS = {
  analyze: 200,
  clip_submissions: 12,
  renders: 40,
  title_suggestions: 50,
  descriptions: 40,
  monitors: 10,
  posts: 16,
};

const isFutureIso = (value) => typeof value === 'string' && Date.parse(value) > Date.now();

export class CutProAdapter extends GuardedAdapter {
  constructor({ catalog = loadCutProCatalog(), quotas = DEFAULT_CUTPRO_QUOTAS, ...options }) {
    super({ name: 'cutpro', catalog, quotas, ...options });
  }

  isScheduled(tool, args) {
    switch (tool.name) {
      case 'createPost':
        return isFutureIso(args.body?.scheduled_at);
      case 'updatePost':
        // scheduled_at null = publicar já; ausente = só troca itens em espera
        return args.body?.scheduled_at === undefined || isFutureIso(args.body.scheduled_at);
      case 'reschedulePostItems':
        return isFutureIso(args.body?.scheduled_at);
      default:
        return false; // publishPost, retryPostItem: saem na hora
    }
  }

  onSuccess(tool, result, latencyMs) {
    if (tool.name !== 'getWorkspace') return;
    this.store.recordHealth({ ok: true, latencyMs, detail: JSON.stringify({ service: this.name }) });
    this.store.setSetting(this.key('auth_alert'), null);
  }

  onFailure(tool, error) {
    if (tool.name === 'getWorkspace') this.store.recordHealth({ ok: false, detail: redact(`${this.name}: ${error.message}`) });
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

  /** Verifica a chave e o workspace (GET /workspace). */
  async checkHealth() {
    try {
      const outcome = await this.run('account.workspace');
      const ws = outcome.operation.result ?? {};
      return { state: 'completed', ok: true, plan: ws.plan ?? ws.plan_name ?? null, workspace: ws.name ?? null };
    } catch (error) {
      return { state: 'failed', ok: false, code: error.code, error: redact(error.message) };
    }
  }
}
