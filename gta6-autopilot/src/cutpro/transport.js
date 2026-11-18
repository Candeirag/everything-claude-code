// Cliente HTTP da API REST da Cut.Pro (https://api.cut.pro/api/v1).
// Monta a requisição a partir do catálogo gerado do openapi.json: parâmetros
// de caminho, de query e corpo. Autenticação pelo header X-Api-Key; a chave
// vem só do ambiente/secret manager e nunca é logada.

import { AuthError, ApiError, TransientError, ViceScaleError } from '../core/errors.js';

const parseRetryAfter = (header) => {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
};

export class CutProHttpTransport {
  kind = 'http';
  deferred = false;
  #apiKey;

  constructor({ catalog, apiKey, workspaceId = null, baseUrl = catalog.baseUrl, timeoutMs = 30_000, fetchImpl = globalThis.fetch }) {
    if (!apiKey) {
      throw new ViceScaleError('CUTPRO_API_KEY não configurada.', { code: 'CONFIG' });
    }
    this.catalog = catalog;
    this.toolsByName = new Map(catalog.tools.map((t) => [t.name, t]));
    this.#apiKey = apiKey;
    this.workspaceId = workspaceId;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async listTools() {
    return null; // o contrato é sincronizado por scripts/sync-cutpro-catalog.js
  }

  buildRequest(name, args) {
    const op = this.toolsByName.get(name);
    if (!op) throw new ViceScaleError(`Operação Cut.Pro desconhecida: ${name}`, { code: 'UNKNOWN_TOOL' });
    const path = op.path.replace(/\{(\w+)\}/g, (_, param) => encodeURIComponent(String(args[param])));
    const url = new URL(`${this.baseUrl}${path}`);
    for (const param of op.queryParams) {
      const value = args[param];
      if (value === undefined || value === null) continue;
      url.searchParams.set(param, Array.isArray(value) ? value.join(',') : String(value));
    }
    const headers = { accept: 'application/json', 'x-api-key': this.#apiKey };
    if (this.workspaceId) headers['x-workspace-id'] = this.workspaceId;
    let body;
    if (args.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(args.body);
    }
    return { url, method: op.method, headers, body };
  }

  async callTool(name, args) {
    const request = this.buildRequest(name, args);
    let response;
    try {
      response = await this.fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: request.body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new TransientError(`Falha de rede ao chamar a Cut.Pro (${name}): ${error.message}`, error);
    }

    const text = await response.text();
    let payload = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text.slice(0, 500) };
      }
    }
    if (response.ok) return payload ?? {};

    const code = payload?.code ?? `HTTP_${response.status}`;
    if (response.status === 401) {
      throw new AuthError(`Cut.Pro recusou a chave de API (${code}). Chave ausente, inválida ou revogada.`);
    }
    if (response.status === 429 || response.status === 503) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
      // Limites de concorrência (fila cheia) não somem com retentativa imediata: viram erro de negócio.
      if (response.status === 429 && code !== 'RATE_LIMIT_EXCEEDED') throw new ApiError(name, response.status, code, payload?.extra);
      throw new TransientError(`Cut.Pro pediu para esperar (${code}).`, null, { retryAfterMs, code });
    }
    if (response.status >= 500) {
      throw new TransientError(`Cut.Pro indisponível (HTTP ${response.status}, ${code}).`, null, { code });
    }
    throw new ApiError(name, response.status, code, payload?.extra);
  }
}
