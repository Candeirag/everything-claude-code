// Cliente MCP "Streamable HTTP" (especificação MCP 2025-06-18), sem dependências.
//
// Só é usado se a ViceScale fornecer URL do servidor MCP e um token de serviço
// (VICESCALE_MCP_URL / VICESCALE_MCP_TOKEN). Nenhuma URL é presumida aqui.
// O token é lido do ambiente, enviado só no header Authorization e nunca logado.

import { AuthError, TransientError, ToolError, ViceScaleError } from '../errors.js';

const PROTOCOL_VERSION = '2025-06-18';

const parseSse = (text, id) => {
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    const message = JSON.parse(data);
    if (message.id === id) return message;
  }
  return null;
};

export class HttpMcpTransport {
  kind = 'http';
  deferred = false;
  #token;
  #sessionId = null;
  #initialized = false;
  #nextId = 1;

  constructor({ url, token, timeoutMs = 30_000, fetchImpl = globalThis.fetch }) {
    if (!url) throw new ViceScaleError('VICESCALE_MCP_URL não configurada.', { code: 'CONFIG' });
    this.url = url;
    this.#token = token;
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl;
  }

  async #post(body) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': PROTOCOL_VERSION,
    };
    if (this.#token) headers.authorization = `Bearer ${this.#token}`;
    if (this.#sessionId) headers['mcp-session-id'] = this.#sessionId;

    let response;
    try {
      response = await this.fetch(this.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new TransientError(`Falha de rede ao falar com o MCP ViceScale: ${error.message}`, error);
    }

    if (response.status === 401 || response.status === 403) {
      throw new AuthError(`MCP ViceScale recusou a autenticação (HTTP ${response.status}). Token ausente, inválido ou expirado.`);
    }
    if (response.status === 404 && this.#sessionId) {
      this.#sessionId = null;
      this.#initialized = false;
      throw new TransientError('Sessão MCP expirou (HTTP 404); será reiniciada na próxima tentativa.');
    }
    if (response.status === 429 || response.status >= 500) {
      throw new TransientError(`MCP ViceScale indisponível (HTTP ${response.status}).`);
    }
    if (!response.ok && response.status !== 202) {
      throw new ViceScaleError(`MCP ViceScale respondeu HTTP ${response.status}.`, { code: 'HTTP' });
    }

    const session = response.headers.get('mcp-session-id');
    if (session) this.#sessionId = session;
    return response;
  }

  async #request(method, params) {
    const id = this.#nextId++;
    const response = await this.#post({ jsonrpc: '2.0', id, method, params });
    const text = await response.text();
    const type = response.headers.get('content-type') ?? '';
    const message = type.includes('text/event-stream') ? parseSse(text, id) : JSON.parse(text);
    if (!message) throw new TransientError(`Resposta MCP sem mensagem para a requisição ${id}.`);
    if (message.error) {
      throw new ViceScaleError(`Erro JSON-RPC ${message.error.code}: ${message.error.message}`, { code: 'JSONRPC' });
    }
    return message.result;
  }

  async #ensureInitialized() {
    if (this.#initialized) return;
    await this.#request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'gta6-autopilot', version: '0.1.0' },
    });
    await this.#post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    this.#initialized = true;
  }

  async listTools() {
    await this.#ensureInitialized();
    const tools = [];
    let cursor;
    do {
      const result = await this.#request('tools/list', cursor ? { cursor } : {});
      tools.push(...result.tools);
      cursor = result.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name, args) {
    await this.#ensureInitialized();
    const result = await this.#request('tools/call', { name, arguments: args });
    if (result.isError) {
      const text = (result.content ?? []).map((c) => c.text ?? '').join('\n') || 'erro sem mensagem';
      throw new ToolError(name, text);
    }
    return result;
  }
}
