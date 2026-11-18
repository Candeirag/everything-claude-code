import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { HttpMcpTransport } from '../src/vicescale/transports/http.js';

// Servidor MCP local mínimo (protocolo Streamable HTTP) só para testar o cliente.
const startServer = (handler) =>
  new Promise((resolve) => {
    const seen = [];
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      const message = JSON.parse(body);
      seen.push({ message, headers: req.headers });
      handler(message, req, res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}/mcp` }));
  });

const reply = (res, id, result, { sse = false, session } = {}) => {
  const headers = session ? { 'mcp-session-id': session } : {};
  const payload = JSON.stringify({ jsonrpc: '2.0', id, result });
  if (sse) {
    res.writeHead(200, { ...headers, 'content-type': 'text/event-stream' });
    res.end(`event: message\ndata: ${payload}\n\n`);
  } else {
    res.writeHead(200, { ...headers, 'content-type': 'application/json' });
    res.end(payload);
  }
};

test('inicializa, propaga sessão e token, lista e chama ferramentas (JSON e SSE)', async () => {
  const { server, seen, url } = await startServer((message, req, res) => {
    if (message.method === 'initialize') return reply(res, message.id, { protocolVersion: '2025-06-18', capabilities: {} }, { session: 'sess-1' });
    if (message.method === 'notifications/initialized') {
      res.writeHead(202);
      return res.end();
    }
    if (message.method === 'tools/list') return reply(res, message.id, { tools: [{ name: 'status', inputSchema: { type: 'object' } }] }, { sse: true });
    if (message.method === 'tools/call') return reply(res, message.id, { content: [{ type: 'text', text: 'Conectado ao ViceScale' }] });
  });
  try {
    const transport = new HttpMcpTransport({ url, token: 'segredo-de-teste' });
    const tools = await transport.listTools();
    assert.deepEqual(tools.map((t) => t.name), ['status']);
    const result = await transport.callTool('status', {});
    assert.equal(result.content[0].text, 'Conectado ao ViceScale');
    const afterInit = seen.filter((s) => s.message.method !== 'initialize');
    assert.ok(afterInit.every((s) => s.headers['mcp-session-id'] === 'sess-1'));
    assert.ok(seen.every((s) => s.headers.authorization === 'Bearer segredo-de-teste'));
  } finally {
    server.close();
  }
});

test('HTTP 401 vira AuthError; isError vira ToolError; 503 vira TransientError', async () => {
  let mode = 'auth';
  const { server, url } = await startServer((message, req, res) => {
    if (mode === 'auth') {
      res.writeHead(401);
      return res.end();
    }
    if (mode === 'down') {
      res.writeHead(503);
      return res.end();
    }
    if (message.method === 'initialize') return reply(res, message.id, {});
    if (message.method === 'notifications/initialized') {
      res.writeHead(202);
      return res.end();
    }
    return reply(res, message.id, { isError: true, content: [{ type: 'text', text: 'projeto não encontrado' }] });
  });
  try {
    await assert.rejects(new HttpMcpTransport({ url, token: 't' }).listTools(), (e) => e.code === 'AUTH' && e.alert);
    mode = 'down';
    await assert.rejects(new HttpMcpTransport({ url }).listTools(), (e) => e.code === 'TRANSIENT' && e.retryable);
    mode = 'tool';
    await assert.rejects(new HttpMcpTransport({ url }).callTool('status_post_template', { projectId: 'x' }), /projeto não encontrado/);
  } finally {
    server.close();
  }
});

test('sem URL configurada falha cedo, sem presumir endpoint', () => {
  assert.throws(() => new HttpMcpTransport({}), /VICESCALE_MCP_URL/);
});
