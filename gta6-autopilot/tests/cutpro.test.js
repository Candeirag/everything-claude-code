import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CutProAdapter, loadCutProCatalog } from '../src/cutpro/adapter.js';
import { CutProHttpTransport } from '../src/cutpro/transport.js';
import { CAPABILITIES, UNAVAILABLE } from '../src/cutpro/capabilities.js';
import { validateToolInput } from '../src/core/schema-validator.js';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { TransientError } from '../src/core/errors.js';

const catalog = loadCutProCatalog();
const future = () => new Date(Date.now() + 3 * 3600 * 1000).toISOString();

const SAMPLES = {
  'account.connections': { platform: 'tiktok' },
  'account.connectLink': { platform: 'tiktok' },
  'source.analyze': { url: 'https://www.youtube.com/watch?v=abc' },
  'source.searchChannels': { platform: 'youtube', query: 'gta 6' },
  'monitor.list': { type: 'video' },
  'monitor.create': { channelUrl: 'https://www.youtube.com/@canal', type: 'video', minDurationSeconds: 60 },
  'monitor.start': { monitorId: '7413020011876610' },
  'monitor.stop': { monitorId: '7413020011876610' },
  'monitor.get': { monitorId: '7413020011876610' },
  'monitor.broadcasts': { monitorId: '7413020011876610', limit: 5 },
  'monitor.broadcastClips': { monitorId: '7413020011876610', broadcastId: '318274651093', minRating: 7 },
  'monitor.renderClip': { monitorId: '7413020011876610', broadcastId: '318274651093', clipId: '7412908412887301' },
  'clip.submit': { videoId: '7412908365112823', startSeconds: 0, endSeconds: 600, strategyId: '7412908371004912' },
  'clip.submissionStatus': { videoId: '7412908365112823', submissionId: '7412908371004912' },
  'clip.list': { videoId: '7412908365112823', submissionId: '7412908371004912', minRating: 7 },
  'clip.subtitles': { videoId: '7412908365112823', submissionId: '7412908371004912', clipId: '7412908412887301' },
  'clip.suggestTitles': { videoId: '7412908365112823', submissionId: '7412908371004912', clipId: '7412908412887301' },
  'clip.feedback': { videoId: '7412908365112823', submissionId: '7412908371004912', clipId: '7412908412887301', feedback: 'down', reason: 'bad_cut' },
  'strategy.create': { name: 'GTA 6 Momentos', focus: 'perseguições e descobertas', titleStyle: 'gancho curto', minSeconds: 20, maxSeconds: 60 },
  'render.clip': { videoId: '7412908365112823', submissionId: '7412908371004912', clipId: '7412908412887301' },
  'render.edit': { editId: '7412910087700001' },
  'render.status': { renderId: '7412910087712256' },
  'render.download': { renderId: '7412910087712256' },
  'copy.postDescription': { editId: '7412910087700001', platforms: ['tiktok', 'youtube'] },
  'publish.post': {
    editId: '7412910087700001',
    scheduledAt: '2026-12-01T21:00:00.000Z',
    targets: [
      { connectionId: '7390012299881100', platform: 'tiktok', title: 'Fuga insana em Vice City #gta6' },
      { connectionId: '7390012299881200', platform: 'youtube', title: 'Fuga insana em Vice City', tags: ['gta6'] },
    ],
  },
  'publish.status': { postId: '7412930011223344' },
  'publish.bestTime': { connectionIds: ['7390012299881100', '7390012299881200'] },
  'publish.cancel': { postId: '7412930011223344' },
  'publish.deleteItem': { postId: '7412930011223344', itemId: '7412930011223401' },
};

test('catálogo gerado do openapi.json: operações esperadas, riscos válidos', () => {
  const names = new Set(catalog.tools.map((t) => t.name));
  for (const name of ['analyzeVideo', 'createSubmission', 'listClips', 'renderClip', 'createPost', 'getPost', 'deletePostItem']) {
    assert.ok(names.has(name), name);
  }
  assert.deepEqual(catalog.missingFromSpec, []);
  assert.equal(catalog.tools.find((t) => t.name === 'deletePostItem').risk, 'destructive');
  assert.equal(catalog.tools.find((t) => t.name === 'createPost').risk, 'publish');
});

test('toda capacidade gera argumentos válidos contra o schema oficial', () => {
  for (const [name, entry] of Object.entries(CAPABILITIES)) {
    const tool = catalog.tools.find((t) => t.name === entry.tool);
    assert.ok(tool, `${name} -> ${entry.tool} inexistente no contrato`);
    assert.deepEqual(validateToolInput(tool, entry.map(SAMPLES[name] ?? {})), [], name);
  }
  for (const name of Object.keys(UNAVAILABLE)) assert.equal(CAPABILITIES[name], undefined);
});

test('publish.post exige título no TikTok/YouTube e usa categoria Gaming', () => {
  const tool = catalog.tools.find((t) => t.name === 'createPost');
  const args = CAPABILITIES['publish.post'].map(SAMPLES['publish.post']);
  assert.equal(args.body.videos[0].targets[1].metadata.youtube.categoryId, '20');
  const semTitulo = structuredClone(args);
  delete semTitulo.body.videos[0].targets[0].metadata.tiktok.title;
  assert.match(validateToolInput(tool, semTitulo).join(), /title: obrigatório/);
});

// ---- transporte HTTP ----------------------------------------------------

const startServer = (handler) =>
  new Promise((resolve) => {
    const seen = [];
    const server = createServer(async (req, res) => {
      let body = '';
      for await (const chunk of req) body += chunk;
      seen.push({ method: req.method, url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null });
      handler(req, res, seen.length);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, seen, baseUrl: `http://127.0.0.1:${server.address().port}/api/v1` }));
  });

const json = (res, status, payload, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
};

test('transporte monta caminho, query, corpo e headers a partir do contrato', async () => {
  const { server, seen, baseUrl } = await startServer((req, res) => json(res, 200, { ok: true }));
  try {
    const transport = new CutProHttpTransport({ catalog, apiKey: 'chave-teste', workspaceId: 'ws1', baseUrl });
    await transport.callTool('listClips', { videoId: 'v 1', submissionId: '7412908371004912', min_rating: 7, sort: 'rating' });
    await transport.callTool('analyzeVideo', { body: { url: 'https://youtu.be/x' } });
    assert.equal(seen[0].method, 'GET');
    assert.equal(seen[0].url, '/api/v1/videos/v%201/submissions/7412908371004912/clips?sort=rating&min_rating=7');
    assert.equal(seen[0].headers['x-api-key'], 'chave-teste');
    assert.equal(seen[0].headers['x-workspace-id'], 'ws1');
    assert.equal(seen[1].method, 'POST');
    assert.deepEqual(seen[1].body, { url: 'https://youtu.be/x' });
  } finally {
    server.close();
  }
});

test('transporte classifica 401, 429 de taxa, 429 de fila e erro de negócio', async () => {
  const responses = [
    [401, { code: 'UNAUTHORIZED' }],
    [429, { code: 'RATE_LIMIT_EXCEEDED' }, { 'retry-after': '7' }],
    [429, { code: 'TOO_MANY_PENDING_CLIPS' }],
    [400, { code: 'VIDEO_TOO_LONG', extra: { duration: 99999, max_duration: 7200 } }],
  ];
  const { server, baseUrl } = await startServer((req, res, n) => json(res, ...responses[n - 1]));
  try {
    const t = new CutProHttpTransport({ catalog, apiKey: 'k', baseUrl });
    await assert.rejects(t.callTool('getWorkspace', {}), (e) => e.code === 'AUTH' && e.alert);
    await assert.rejects(t.callTool('getWorkspace', {}), (e) => e.retryable && e.retryAfterMs === 7000);
    await assert.rejects(t.callTool('getWorkspace', {}), (e) => !e.retryable && e.code === 'TOO_MANY_PENDING_CLIPS');
    await assert.rejects(t.callTool('analyzeVideo', { body: { url: 'https://youtu.be/x' } }), (e) => e.code === 'VIDEO_TOO_LONG' && e.extra.max_duration === 7200);
  } finally {
    server.close();
  }
});

test('sem chave de API o transporte falha cedo', () => {
  assert.throws(() => new CutProHttpTransport({ catalog }), /CUTPRO_API_KEY/);
});

// ---- adaptador ----------------------------------------------------------

const fakeTransport = (script = {}) => {
  const calls = [];
  return {
    kind: 'test',
    deferred: false,
    calls,
    async listTools() {
      return null;
    },
    async callTool(name, args) {
      calls.push({ name, args });
      const step = script[name];
      const next = Array.isArray(step) ? step.shift() : step;
      if (next instanceof Error) throw next;
      return next ?? { ok: true };
    },
  };
};

const setup = (transport, opts = {}) => {
  const store = new SqliteStore(':memory:');
  const sleeps = [];
  const adapter = new CutProAdapter({ transport, store, sleep: async (ms) => sleeps.push(ms), ...opts });
  return { adapter, store, sleeps };
};

test('cortar material exige direitos de uso registrados', async () => {
  const transport = fakeTransport();
  const { adapter } = setup(transport);
  await assert.rejects(adapter.run('clip.submit', SAMPLES['clip.submit'], { idempotencyKey: 'sub-1' }), /direitos de uso/);
  await assert.rejects(adapter.run('monitor.create', SAMPLES['monitor.create'], { idempotencyKey: 'mon-1' }), /direitos de uso/);
  const ok = await adapter.run('clip.submit', SAMPLES['clip.submit'], { idempotencyKey: 'sub-1', context: { rightsCleared: true } });
  assert.equal(ok.state, 'completed');
  assert.equal(transport.calls[0].args.body.source_language, 'pt');
});

test('publicação: agendamento futuro obrigatório e dry-run por padrão', async () => {
  const transport = fakeTransport();
  const { adapter } = setup(transport);
  const ctx = { rightsCleared: true };
  const semHorario = { ...SAMPLES['publish.post'], scheduledAt: undefined };
  await assert.rejects(adapter.run('publish.post', semHorario, { idempotencyKey: 'p-0', context: ctx }), /imediata bloqueada/);
  const passado = { ...SAMPLES['publish.post'], scheduledAt: '2020-01-01T00:00:00.000Z' };
  await assert.rejects(adapter.run('publish.post', passado, { idempotencyKey: 'p-1', context: ctx }), /imediata bloqueada/);
  const outcome = await adapter.run('publish.post', { ...SAMPLES['publish.post'], scheduledAt: future() }, { idempotencyKey: 'p-2', context: ctx });
  assert.equal(outcome.state, 'dry_run');
  assert.equal(transport.calls.length, 0);
});

test('exclusão de item publicado exige confirmação e é simulada no dry-run', async () => {
  const transport = fakeTransport();
  const { adapter } = setup(transport);
  await assert.rejects(adapter.run('publish.deleteItem', SAMPLES['publish.deleteItem'], { idempotencyKey: 'd-1' }), /destrutiva/);
  const outcome = await adapter.run('publish.deleteItem', SAMPLES['publish.deleteItem'], {
    idempotencyKey: 'd-1',
    context: { confirmDestructive: true },
  });
  assert.equal(outcome.state, 'dry_run');
  assert.equal(transport.calls.length, 0);
});

test('emergência bloqueia publicar, mas permite cancelar post agendado', async () => {
  const transport = fakeTransport();
  const { adapter } = setup(transport, { dryRun: 'off' });
  adapter.setEmergencyStop(true);
  await assert.rejects(
    adapter.run('publish.post', { ...SAMPLES['publish.post'], scheduledAt: future() }, { idempotencyKey: 'p-e', context: { rightsCleared: true } }),
    /emergência/,
  );
  const cancel = await adapter.run('publish.cancel', { postId: '7412930011223344' }, { idempotencyKey: 'cancel-p1' });
  assert.equal(cancel.state, 'completed');
  assert.equal(transport.calls[0].name, 'cancelPost');
});

test('leitura respeita Retry-After; escrita não repete', async () => {
  const transport = fakeTransport({
    listConnections: [new TransientError('limite', null, { retryAfterMs: 7000 }), { connections: [] }],
    renderClip: [new TransientError('rede'), { id: '7412910087712256' }],
  });
  const { adapter, sleeps } = setup(transport);
  const read = await adapter.run('account.connections');
  assert.equal(read.state, 'completed');
  assert.deepEqual(sleeps, [7000]);
  await assert.rejects(adapter.run('render.clip', SAMPLES['render.clip'], { idempotencyKey: 'r-c1' }), TransientError);
  assert.equal(transport.calls.filter((c) => c.name === 'renderClip').length, 1);
});

test('métricas por post: indisponível com alternativa, sem simular', async () => {
  const { adapter } = setup(fakeTransport());
  await assert.rejects(adapter.run('analytics.postMetrics', {}), (e) => e.code === 'CAPABILITY_UNAVAILABLE' && /YouTube Data API/.test(e.alternative));
});

test('cotas e alertas do Cut.Pro não se misturam com os da ViceScale', async () => {
  const { adapter, store } = setup(fakeTransport({ getWorkspace: new (await import('../src/core/errors.js')).AuthError('chave inválida') }), {
    quotas: { renders: 1 },
  });
  const health = await adapter.checkHealth();
  assert.equal(health.ok, false);
  assert.ok(store.getSetting('cutpro:auth_alert'));
  assert.equal(store.getSetting('vicescale:auth_alert'), null);
  await adapter.run('render.clip', SAMPLES['render.clip'], { idempotencyKey: 'q-1' });
  await assert.rejects(adapter.run('render.clip', { ...SAMPLES['render.clip'], clipId: '7412908412887302' }, { idempotencyKey: 'q-2' }), /Limite diário/);
  assert.equal(store.quotaUsed('cutpro:renders'), 1);
});
