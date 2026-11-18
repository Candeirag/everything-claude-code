import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ViceScaleMCPAdapter, parseAccountStatus } from '../src/vicescale/adapter.js';
import { ClaudeBridgeTransport } from '../src/vicescale/transports/bridge.js';
import { SqliteStore } from '../src/store/sqlite-store.js';
import { AuthError, TransientError } from '../src/vicescale/errors.js';

// Dublê de transporte síncrono: registra chamadas e devolve respostas roteirizadas.
const scriptedTransport = (script = {}) => {
  const calls = [];
  return {
    kind: 'test',
    deferred: false,
    calls,
    async listTools() {
      return script.tools ?? null;
    },
    async callTool(name, args) {
      calls.push({ name, args });
      const step = script[name];
      const next = Array.isArray(step) ? step.shift() : step;
      if (next instanceof Error) throw next;
      return next ?? { content: [{ type: 'text', text: 'ok' }] };
    },
  };
};

const STATUS_TEXT = 'Conectado ao ViceScale\nConta: alguem@exemplo.com\nPlano: Vitalício\nProjetos Scale: 1\nRedes conectadas: nenhuma (conecte em /integracoes).';

const setup = (transport, opts = {}) => {
  const store = new SqliteStore(':memory:');
  const adapter = new ViceScaleMCPAdapter({ transport, store, sleep: async () => {}, ...opts });
  return { adapter, store };
};

const publishInput = {
  projectId: 'p1',
  platform: 'youtube',
  caption: 'Legenda',
  scheduleAt: '2026-12-01T10:00',
  timezone: 'America/Sao_Paulo',
};

test('parseAccountStatus extrai plano/redes e descarta o e-mail', () => {
  const parsed = parseAccountStatus(STATUS_TEXT);
  assert.deepEqual(parsed, { connected: true, plan: 'Vitalício', scaleProjects: 1, networks: null });
  assert.ok(!JSON.stringify(parsed).includes('@'));
});

test('leitura executa, registra saúde e não grava e-mail na auditoria', async () => {
  const transport = scriptedTransport({ status: { content: [{ type: 'text', text: STATUS_TEXT }] } });
  const { adapter, store } = setup(transport);
  const health = await adapter.checkHealth();
  assert.equal(health.state, 'completed');
  assert.equal(health.connected, true);
  assert.equal(store.lastHealth().ok, true);
  assert.ok(!JSON.stringify(store.listAudit()).includes('alguem@exemplo.com'));
});

test('leitura com erro transitório é repetida; erro de autenticação gera alerta', async () => {
  const transport = scriptedTransport({ listar_reposts: [new TransientError('timeout'), { content: [] }] });
  const { adapter, store } = setup(transport);
  const outcome = await adapter.run('repost.list', { limit: 3 });
  assert.equal(outcome.state, 'completed');
  assert.equal(transport.calls.length, 2);

  const authTransport = scriptedTransport({ status: new AuthError('expirado') });
  const second = setup(authTransport);
  const health = await second.adapter.checkHealth();
  assert.equal(health.state, 'failed');
  assert.ok(second.store.getSetting('auth_alert'));
  assert.equal(second.store.lastHealth().ok, false);
});

test('escrita NÃO é repetida automaticamente após erro transitório', async () => {
  const transport = scriptedTransport({ baixar_video: [new TransientError('reset'), { content: [] }] });
  const { adapter, store } = setup(transport);
  await assert.rejects(adapter.run('media.import', { url: 'https://www.tiktok.com/@a/video/1' }, { idempotencyKey: 'dl-1' }), TransientError);
  assert.equal(transport.calls.length, 1);
  assert.equal(store.findOperationByKey('dl-1').state, 'failed');
  // repetir com a mesma chave exige retryFailed explícito
  await assert.rejects(adapter.run('media.import', { url: 'https://www.tiktok.com/@a/video/1' }, { idempotencyKey: 'dl-1' }), /já existe/);
  const retried = await adapter.run('media.import', { url: 'https://www.tiktok.com/@a/video/1' }, { idempotencyKey: 'dl-1', retryFailed: true });
  assert.equal(retried.state, 'completed');
});

test('operações que gastam cota exigem chave de idempotência e não duplicam', async () => {
  const transport = scriptedTransport();
  const { adapter } = setup(transport);
  await assert.rejects(adapter.run('post.render', { projectId: 'p' }), /idempotencyKey/);
  const first = await adapter.run('post.render', { projectId: 'p' }, { idempotencyKey: 'render-p' });
  const second = await adapter.run('post.render', { projectId: 'p' }, { idempotencyKey: 'render-p' });
  assert.equal(first.state, 'completed');
  assert.equal(second.reused, true);
  assert.equal(transport.calls.length, 1);
});

test('cota diária interna bloqueia excesso', async () => {
  const { adapter } = setup(scriptedTransport(), { quotas: { render: 1 } });
  await adapter.run('post.render', { projectId: 'a' }, { idempotencyKey: 'r-a' });
  await assert.rejects(adapter.run('post.render', { projectId: 'b' }, { idempotencyKey: 'r-b' }), /Limite diário/);
});

test('publicação: exige direitos, agendamento e respeita dry-run padrão', async () => {
  const transport = scriptedTransport();
  const { adapter } = setup(transport);
  await assert.rejects(adapter.run('publish.video', publishInput, { idempotencyKey: 'pub-1' }), /direitos de uso/);
  const { scheduleAt, timezone, ...immediate } = publishInput;
  await assert.rejects(
    adapter.run('publish.video', immediate, { idempotencyKey: 'pub-2', context: { rightsCleared: true } }),
    /imediata bloqueada/,
  );
  const outcome = await adapter.run('publish.video', publishInput, { idempotencyKey: 'pub-3', context: { rightsCleared: true } });
  assert.equal(outcome.state, 'dry_run');
  assert.equal(outcome.operation.result.wouldCall.tool, 'publicar_template');
  assert.equal(transport.calls.length, 0, 'dry-run nunca chama o servidor');
});

test('botão de emergência bloqueia publicações mesmo fora do dry-run', async () => {
  const transport = scriptedTransport();
  const { adapter } = setup(transport, { dryRun: 'off' });
  adapter.setEmergencyStop(true);
  await assert.rejects(
    adapter.run('publish.video', publishInput, { idempotencyKey: 'pub-e', context: { rightsCleared: true } }),
    /emergência/,
  );
  adapter.setEmergencyStop(false);
  const outcome = await adapter.run('publish.video', publishInput, { idempotencyKey: 'pub-e', context: { rightsCleared: true } });
  assert.equal(outcome.state, 'completed');
  assert.equal(transport.calls[0].args.plataforma, 'youtube');
});

test('TikTok e métricas retornam indisponível com alternativa, sem simular', async () => {
  const { adapter } = setup(scriptedTransport());
  await assert.rejects(adapter.run('publish.tiktok', {}), (error) => error.code === 'CAPABILITY_UNAVAILABLE' && /manual/.test(error.alternative));
  await assert.rejects(adapter.run('analytics.postMetrics', {}), /indisponível/);
});

test('parâmetros inválidos nunca chegam ao transporte', async () => {
  const transport = scriptedTransport();
  const { adapter } = setup(transport);
  await assert.rejects(adapter.execute('buscar_perfil', { usuario: 'a', quantidade: 999 }), /máximo 50/);
  await assert.rejects(adapter.execute('ferramenta_inventada', {}), /não existe/);
  assert.equal(transport.calls.length, 0);
});

test('ponte Claude: enfileira, entrega ao worker e registra resultado', async () => {
  const { adapter, store } = setup(new ClaudeBridgeTransport());
  const health = await adapter.checkHealth();
  assert.equal(health.state, 'queued');
  const claimed = adapter.claimBridgedOperation();
  assert.equal(claimed.tool, 'status');
  assert.equal(claimed.state, 'dispatched');
  assert.equal(adapter.claimBridgedOperation(), null);

  adapter.completeBridgedOperation(claimed.id, { text: STATUS_TEXT });
  assert.equal(store.getOperation(claimed.id).state, 'completed');
  assert.equal(store.lastHealth().ok, true);
  assert.throws(() => adapter.completeBridgedOperation(claimed.id, { text: 'de novo' }), /não em "dispatched"/);
});

test('ponte Claude: falha de autenticação reportada pelo worker gera alerta', async () => {
  const { adapter, store } = setup(new ClaudeBridgeTransport());
  await adapter.run('scale.list', { limit: 1 });
  const op = adapter.claimBridgedOperation();
  adapter.completeBridgedOperation(op.id, { error: 'Conector desconectado', authError: true });
  assert.equal(store.getOperation(op.id).state, 'failed');
  assert.ok(store.getSetting('auth_alert'));
});

test('descoberta detecta ferramenta nova, removida e schema alterado', async () => {
  const tools = [
    { name: 'status', inputSchema: { type: 'object', properties: {} } },
    { name: 'nova_ferramenta', inputSchema: { type: 'object' } },
    { name: 'listar_reposts', inputSchema: { type: 'object', properties: { limite: { type: 'integer', minimum: 1, maximum: 99 } } } },
  ];
  const { adapter, store } = setup(scriptedTransport({ tools }));
  const diff = await adapter.discover();
  assert.deepEqual(diff.added, ['nova_ferramenta']);
  assert.ok(diff.removed.includes('publicar_template'));
  assert.deepEqual(diff.changed, ['listar_reposts']);
  assert.ok(store.getSetting('catalog_drift_alert'));
  assert.equal(store.lastCatalogSnapshot().tools.length, 3);
});

test('resultados gravados no banco não guardam e-mail (síncrono e ponte)', async () => {
  const sync = setup(scriptedTransport({ status: { content: [{ type: 'text', text: STATUS_TEXT }] } }));
  await sync.adapter.checkHealth();
  assert.ok(!JSON.stringify(sync.store.listOperations()).includes('alguem@exemplo.com'));

  const bridge = setup(new ClaudeBridgeTransport());
  await bridge.adapter.checkHealth();
  const op = bridge.adapter.claimBridgedOperation();
  bridge.adapter.completeBridgedOperation(op.id, { text: STATUS_TEXT });
  assert.ok(!JSON.stringify(bridge.store.listOperations()).includes('alguem@exemplo.com'));
  assert.equal(bridge.store.lastHealth().ok, true);
});
