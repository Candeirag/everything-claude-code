import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCatalog } from '../src/vicescale/adapter.js';
import { validateToolInput } from '../src/vicescale/schema-validator.js';
import { CAPABILITIES, UNAVAILABLE } from '../src/vicescale/capabilities.js';
import { redact } from '../src/lib/redact.js';

const catalog = loadCatalog();
const tool = (name) => catalog.tools.find((t) => t.name === name);

test('catálogo tem as 22 ferramentas descobertas, todas com risco conhecido', () => {
  assert.equal(catalog.tools.length, 22);
  for (const t of catalog.tools) assert.ok(['read', 'quota', 'publish'].includes(t.risk), t.name);
});

test('todos os schemas do catálogo usam só palavras-chave suportadas', () => {
  for (const t of catalog.tools) {
    const problems = validateToolInput(t, {}).filter((p) => p.includes('não suportada'));
    assert.deepEqual(problems, [], t.name);
  }
});

test('validação recusa parâmetro inventado, enum inválido e limites', () => {
  assert.match(validateToolInput(tool('buscar_perfil'), { usuario: 'x', inventado: 1 }).join(), /não aceito/);
  assert.match(validateToolInput(tool('buscar_perfil'), { usuario: 'x', quantidade: 51 }).join(), /máximo 50/);
  assert.match(validateToolInput(tool('buscar_perfil'), {}).join(), /usuario: obrigatório/);
  assert.match(
    validateToolInput(tool('publicar_template'), { projectId: 'p', plataforma: 'tiktok', legenda: 'x' }).join(),
    /fora de/,
  );
  assert.match(validateToolInput(tool('baixar_video'), { url: 'nao-e-url' }).join(), /URL inválida/);
});

test('regras locais: agendarPara exige timezone e formato; usuario OU url', () => {
  const base = { projectId: 'p', plataforma: 'youtube', legenda: 'x' };
  assert.match(validateToolInput(tool('publicar_template'), { ...base, agendarPara: '2026-12-01T10:00' }).join(), /timezone/);
  assert.match(
    validateToolInput(tool('publicar_template'), { ...base, agendarPara: '01/12 10h', timezone: 'America/Sao_Paulo' }).join(),
    /formato inválido/,
  );
  assert.deepEqual(
    validateToolInput(tool('publicar_template'), { ...base, agendarPara: '2026-12-01T10:00', timezone: 'America/Sao_Paulo' }),
    [],
  );
  assert.match(validateToolInput(tool('buscar_fotos_perfil'), { usuario: 'a', url: 'b' }).join(), /exatamente um/);
  assert.deepEqual(validateToolInput(tool('buscar_fotos_perfil'), { usuario: 'a' }), []);
});

test('toda capacidade aponta para ferramenta existente e produz args válidos', () => {
  const samples = {
    'source.instagramProfileVideos': { username: 'perfil', limit: 5 },
    'source.instagramProfilePosts': { username: 'perfil' },
    'media.resolveUrl': { url: 'https://www.instagram.com/reel/abc/' },
    'media.import': { url: 'https://www.instagram.com/reel/abc/' },
    'copy.suggestPhrases': { topic: 'mapa de Vice City' },
    'copy.suggestHeadlines': { topic: 'fuga da polícia', mode: 'gta', count: 3 },
    'post.create': { name: 'teste', videos: [{ storagePath: 's/1.mp4', durationSeconds: 30 }], phrases: ['oi'], style: 'twitter' },
    'post.render': { projectId: 'p' },
    'post.status': { projectId: 'p' },
    'repost.create': { url: 'https://www.instagram.com/p/abc/' },
    'repost.translateCaption': { projectId: 'p' },
    'repost.rewriteCaption': { projectId: 'p' },
    'repost.translateImage': { projectId: 'p' },
    'repost.status': { projectId: 'p' },
    'publish.video': { projectId: 'p', platform: 'youtube', caption: 'x', scheduleAt: '2026-12-01T10:00', timezone: 'America/Sao_Paulo' },
    'publish.image': { projectId: 'p', platform: 'instagram' },
  };
  for (const [name, entry] of Object.entries(CAPABILITIES)) {
    const t = tool(entry.tool);
    assert.ok(t, `${name} -> ${entry.tool} inexistente`);
    assert.deepEqual(validateToolInput(t, entry.map(samples[name] ?? {})), [], name);
  }
});

test('capacidades indisponíveis não colidem com disponíveis e têm alternativa', () => {
  for (const [name, u] of Object.entries(UNAVAILABLE)) {
    assert.equal(CAPABILITIES[name], undefined, name);
    assert.ok(u.reason && u.alternative, name);
  }
});

test('redact remove tokens, Bearer e e-mails', () => {
  const out = redact({ apiToken: 'abc', nested: { note: 'Bearer xyz.123 de fulano@exemplo.com' } });
  assert.equal(out.apiToken, '[REDACTED]');
  assert.equal(out.nested.note, 'Bearer [REDACTED] de [EMAIL]');
});
