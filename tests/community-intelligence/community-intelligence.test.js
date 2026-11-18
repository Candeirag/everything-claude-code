'use strict';

/**
 * Tests for skills/community-intelligence (GTA 6 Autopilot, módulo 9).
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const LIB = path.join(__dirname, '..', '..', 'skills', 'community-intelligence', 'scripts', 'lib');
const CLI_PATH = path.join(__dirname, '..', '..', 'skills', 'community-intelligence', 'scripts', 'community-intel.js');
const parser = require(path.join(LIB, 'parser'));
const privacy = require(path.join(LIB, 'privacy'));
const { listEntries, extractChatTranscript } = require(path.join(LIB, 'zip'));
const { loadTaxonomy } = require(path.join(LIB, 'taxonomy'));
const { analyze } = require(path.join(LIB, 'analyze'));
const { computeSignals } = require(path.join(LIB, 'signals'));
const perf = require(path.join(LIB, 'performance'));
const sugg = require(path.join(LIB, 'suggestions'));
const pipeline = require(path.join(LIB, 'pipeline'));
const { esc } = require(path.join(LIB, 'dashboard'));
const cli = require(CLI_PATH);
const fixtures = require('./fixtures');

console.log('=== Testing community-intelligence ===\n');

let passed = 0;
let failed = 0;

function test(desc, fn) {
  try {
    fn();
    console.log(`  ✓ ${desc}`);
    passed++;
  } catch (error) {
    console.log(`  ✗ ${desc}: ${error.message}`);
    failed++;
  }
}

const tmpDirs = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writeTmp(dir, name, content) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

/** Minimal ZIP writer (deflate) for archive tests. */
function buildZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content);
    const compressed = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, compressed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + compressed.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function initStore(options = {}) {
  const dataDir = tmpDir();
  pipeline.init({ dataDir, consentConfirmed: true, consentNote: 'Admin autorizou análise agregada', now: '2026-11-16T12:00:00Z', ...options });
  return dataDir;
}

function importFixture(dataDir, content = fixtures.buildAndroidExport(), name = 'export.txt') {
  const file = writeTmp(tmpDir(), name, content);
  return pipeline.importFile(file, { dataDir, now: '2026-11-16T12:00:00Z' });
}

// ---------------------------------------------------------------- parser
console.log('Parser:');

test('parses Android pt-BR export, drops system/media/deleted, keeps multi-line', () => {
  const result = parser.parseWhatsAppExport(fixtures.buildAndroidExport());
  assert.strictEqual(result.dateOrder, 'dmy');
  assert.strictEqual(result.stats.system, 2);
  assert.strictEqual(result.stats.media, 1);
  assert.strictEqual(result.stats.deleted, 1);
  const last = result.messages[result.messages.length - 1];
  assert.ok(last.text.includes('\n- debate da data de lançamento'));
  assert.strictEqual(last.timestamp, '2026-11-15T10:00:00');
});

test('parses iOS en-US export with 12h clock and LRM system notices', () => {
  const result = parser.parseWhatsAppExport(fixtures.buildIosExport());
  assert.strictEqual(result.dateOrder, 'mdy');
  assert.strictEqual(result.messages.length, 3);
  assert.strictEqual(result.messages[0].timestamp, '2026-11-14T21:06:00');
  assert.strictEqual(result.messages[2].timestamp, '2026-11-14T00:15:00', '12:15 AM must become 00:15');
  assert.ok(!result.messages.some(m => /encrypted/.test(m.text)));
});

test('ambiguous dates fall back to the requested order', () => {
  const text = '01/02/2026 10:00 - Ana: oi\n01/02/2026 10:01 - Bruno: olá\n01/02/2026 10:02 - Carla: ei';
  assert.strictEqual(parser.parseWhatsAppExport(text).messages[0].timestamp.slice(0, 10), '2026-02-01');
  assert.strictEqual(parser.parseWhatsAppExport(text, { dateOrder: 'mdy' }).messages[0].timestamp.slice(0, 10), '2026-01-02');
});

test('rejects files that are not WhatsApp exports', () => {
  assert.throws(() => parser.parseWhatsAppExport('just some text\nnothing here'), /Formato não reconhecido/);
});

test('parses normalized JSONL and JSON array', () => {
  const jsonl = '{"timestamp":"2026-11-10T10:00:00","author":"a","text":"trailer"}\n{"timestamp":1762768800,"author":"b","text":"mapa"}\n{"timestamp":"2026-11-10","author":"c","text":"x","type":"image"}';
  const result = parser.parseNormalizedJson(jsonl);
  assert.strictEqual(result.messages.length, 2);
  assert.strictEqual(result.stats.media, 1);
  const arr = parser.parseNormalizedJson('[{"timestamp":"2026-11-10 10:00","author":"a","text":"oi"}]');
  assert.strictEqual(arr.messages[0].timestamp, '2026-11-10T10:00:00');
});

test('reads _chat.txt from iOS zip and never extracts media', () => {
  const zip = buildZip([['IMG-0001.jpg', 'binary'], ['_chat.txt', fixtures.buildIosExport()], ['AUD-0002.opus', 'audio']]);
  assert.strictEqual(listEntries(zip).length, 3);
  const { text, ignoredEntries } = extractChatTranscript(zip);
  assert.ok(text.includes('Did you see the new trailer?'));
  assert.strictEqual(ignoredEntries, 2);
  const dir = tmpDir();
  const file = writeTmp(dir, 'WhatsApp Chat.zip', zip);
  const parsed = parser.parseSourceFile(file);
  assert.strictEqual(parsed.format, 'whatsapp-zip');
  assert.strictEqual(parsed.messages.length, 3);
});

// ---------------------------------------------------------------- privacy
console.log('\nPrivacy:');

test('pseudonyms are stable, salted and never contain the name', () => {
  const a = privacy.pseudonymize('Ana Souza', 'salt-1');
  assert.strictEqual(a, privacy.pseudonymize('ana souza', 'salt-1'));
  assert.notStrictEqual(a, privacy.pseudonymize('Ana Souza', 'salt-2'));
  assert.ok(/^p_[0-9a-f]{12}$/.test(a));
  assert.throws(() => privacy.pseudonymize('Ana', ''), /Salt/);
});

test('redacts phones, e-mails, mentions, documents, private links and participant names', () => {
  const redact = privacy.buildRedactor(['Carla Dias', 'João Alves', 'Lucia Prado']);
  const out = redact('Fala com a carla ou o JOAO no +55 (11) 98765-4321, 98765-4321, joao@ex.com, @5511987654321, CPF 123.456.789-09, https://chat.whatsapp.com/xyz e https://www.rockstargames.com/newswire');
  for (const leaked of ['carla', 'JOAO', '98765', 'joao@', '@5511', '123.456', 'chat.whatsapp']) {
    assert.ok(!out.includes(leaked), `leaked "${leaked}" in: ${out}`);
  }
  assert.ok(out.includes('[link:rockstargames.com]'));
  assert.ok(out.includes('[participante]'));
});

test('keeps years, prices and GTA character names that collide with participant names', () => {
  const redact = privacy.buildRedactor(['Lucia Prado', 'Jason Melo']);
  const out = redact('Lançamento 2026-2027, preço R$ 399,90; a Lucia e o Jason no trailer');
  assert.ok(out.includes('2026-2027'));
  assert.ok(out.includes('399,90'));
  assert.ok(out.includes('Lucia') && out.includes('Jason'));
});

test('import requires recorded consent', () => {
  const dataDir = tmpDir();
  pipeline.init({ dataDir, now: '2026-11-16T12:00:00Z' });
  assert.throws(() => importFixture(dataDir), /Consentimento não registrado/);
  assert.throws(() => pipeline.init({ dataDir, consentConfirmed: true }), /consent-note/);
});

test('private conversations (fewer than 3 authors) are refused', () => {
  const dataDir = initStore();
  assert.throws(() => importFixture(dataDir, fixtures.buildPrivateChatExport()), /privadas/);
});

test('stored data contains no names, phones or e-mails', () => {
  const dataDir = initStore();
  importFixture(dataDir);
  pipeline.analyzeAndPublish({ dataDir, asOf: '2026-11-15', now: '2026-11-16T12:00:00Z' });
  const dump = [];
  const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full); else dump.push(fs.readFileSync(full, 'utf8'));
  });
  walk(dataDir);
  const all = dump.join('\n');
  for (const person of fixtures.PEOPLE) {
    assert.ok(!all.includes(person), `found participant "${person}" on disk`);
  }
  for (const leaked of ['97777-6666', 'fulano@example.com', '5511988887777', 'AbCdEf']) {
    assert.ok(!all.includes(leaked), `found "${leaked}" on disk`);
  }
});

test('handoffs and dashboard expose no message text or pseudonyms', () => {
  const dataDir = initStore();
  importFixture(dataDir);
  const result = pipeline.analyzeAndPublish({ dataDir, asOf: '2026-11-15', now: '2026-11-16T12:00:00Z' });
  const outputs = [...result.handoffFiles, result.dashboard, path.join(dataDir, 'dashboard', 'data.json')]
    .map(file => fs.readFileSync(file, 'utf8')).join('\n');
  assert.ok(!/p_[0-9a-f]{12}/.test(outputs), 'pseudonym leaked into outputs');
  for (const phrase of ['Revi o trailer 10 vezes', 'insider postou', 'Discordo, a Rockstar']) {
    assert.ok(!outputs.includes(phrase), `message text "${phrase}" leaked into outputs`);
  }
  const scout = JSON.parse(fs.readFileSync(result.handoffFiles.find(f => f.endsWith('gta-scout.json')), 'utf8'));
  assert.strictEqual(scout.privacy.containsMessageText, false);
  assert.strictEqual(scout.privacy.trainingUse, 'prohibited');
});

test('opt-out removes existing messages and blocks future imports', () => {
  const dataDir = initStore();
  importFixture(dataDir);
  const before = pipeline.status({ dataDir }).messages;
  const { removed } = pipeline.optOut('João Alves', { dataDir });
  assert.strictEqual(removed, 17);
  assert.strictEqual(pipeline.status({ dataDir }).messages, before - 17);
  const dataDir2 = initStore();
  pipeline.optOut('João Alves', { dataDir: dataDir2 });
  const manifest = importFixture(dataDir2);
  assert.strictEqual(manifest.skipped.optedOut, 17);
});

// ---------------------------------------------------------------- storage
console.log('\nStorage and deletion:');

test('overlapping periodic exports are de-duplicated', () => {
  const dataDir = initStore();
  const first = importFixture(dataDir);
  const second = importFixture(dataDir);
  assert.strictEqual(first.storedMessages, 53);
  assert.strictEqual(second.storedMessages, 0);
  assert.strictEqual(second.skipped.duplicates, 53);
  assert.strictEqual(pipeline.status({ dataDir }).messages, 53);
});

test('manifest stores no source file name', () => {
  const dataDir = initStore();
  const manifest = importFixture(dataDir, fixtures.buildAndroidExport(), 'Conversa do WhatsApp com Grupo Secreto.txt');
  assert.ok(!JSON.stringify(manifest).includes('Grupo Secreto'));
});

test('purge by import, by age and all', () => {
  const dataDir = initStore();
  const manifest = importFixture(dataDir);
  assert.throws(() => pipeline.purge({ dataDir, importId: manifest.id }), /--yes/);
  const aged = pipeline.purge({ dataDir, olderThanDays: 10, yes: true, now: '2026-11-16T12:00:00Z' });
  assert.strictEqual(aged.removed, 6, 'messages before 2026-11-06 12:00 removed');
  pipeline.purge({ dataDir, importId: manifest.id, yes: true });
  assert.strictEqual(pipeline.status({ dataDir }).imports, 0);
  pipeline.purge({ dataDir, all: true, yes: true });
  assert.strictEqual(fs.existsSync(dataDir), false);
});

test('retention window drops old messages at import', () => {
  const dataDir = initStore({ retentionDays: 5 });
  const manifest = importFixture(dataDir);
  assert.ok(manifest.skipped.expired > 0);
  assert.ok(manifest.period.from >= '2026-11-11');
});

// ---------------------------------------------------------------- analysis
console.log('\nAnalysis and ranking:');

function fixtureAnalysis() {
  const salt = 'test-salt';
  const parsed = parser.parseWhatsAppExport(fixtures.buildAndroidExport());
  const messages = parsed.messages.map((m, i) => ({ id: String(i), ts: m.timestamp, author: privacy.pseudonymize(m.author, salt), text: m.text }));
  return analyze({ messages, taxonomy: loadTaxonomy(null), asOf: '2026-11-15', windowDays: 7 });
}

test('signals detect questions, curiosity, disagreement and hype', () => {
  assert.ok(computeSignals('Alguém sabe quando sai?').question);
  assert.ok(computeSignals('Vocês repararam no detalhe?').curiosity);
  assert.ok(computeSignals('Discordo totalmente').disagreement);
  assert.ok(computeSignals('Trailer insano 🔥').hype);
  assert.ok(!computeSignals('Bom dia').question);
});

test('message volume from one person does not beat broad discussion', () => {
  const result = fixtureAnalysis();
  const vehicles = result.ranking.find(r => r.id === 'vehicles');
  const trailers = result.ranking.find(r => r.id === 'trailers');
  assert.ok(vehicles.current.messages > trailers.current.messages, 'fixture: vehicles has more messages');
  assert.ok(trailers.score > vehicles.score, 'broad topic must outrank flooded topic');
  assert.ok(vehicles.dominancePenalty < 1);
  assert.strictEqual(vehicles.confidence, 'baixa');
  assert.strictEqual(result.ranking[0].id, 'trailers');
});

test('detects emergent terms outside the taxonomy', () => {
  const result = fixtureAnalysis();
  const emergent = result.ranking.find(r => r.id === 'emergente:modo-foto');
  assert.ok(emergent, 'modo foto should emerge');
  assert.strictEqual(emergent.current.authors, 5);
  assert.ok(result.emergingTrends.includes('emergente:modo-foto'));
});

test('short replies inherit the topic of the thread', () => {
  const result = fixtureAnalysis();
  const release = result.ranking.find(r => r.id === 'release-date');
  assert.ok(release.current.weighted < release.current.messages, 'inherited replies count at half weight');
  assert.ok(release.components.debate > 0.3);
});

test('rumor topics are flagged and topics with no current discussion score zero', () => {
  const result = fixtureAnalysis();
  assert.strictEqual(result.ranking.find(r => r.id === 'leaks-rumors').risk, 'rumor');
  const price = result.ranking.find(r => r.id === 'price-editions');
  assert.strictEqual(price.current.messages, 0);
  assert.strictEqual(price.score, 0);
});

test('weekly history covers 8 weeks', () => {
  const result = fixtureAnalysis();
  assert.strictEqual(result.history.weeks.length, 8);
  const trailers = result.ranking.find(r => r.id === 'trailers');
  assert.strictEqual(result.history.series.trailers[7], trailers.current.weighted);
  assert.strictEqual(result.history.series.trailers[0], 0);
});

// ---------------------------------------------------------------- suggestions
console.log('\nSuggestions:');

test('suggestions always require fact-check; rumors are framed as rumors', () => {
  const result = fixtureAnalysis();
  const rumorRow = result.ranking.find(r => r.id === 'leaks-rumors');
  const s = sugg.buildSuggestion(rumorRow, result.asOf, 'teste');
  assert.ok(s.title.startsWith('Rumor ou fato?'));
  assert.strictEqual(s.factCheck.required, true);
  assert.deepStrictEqual(s.routedTo, ['gta-scout', 'trend-analyst']);
});

test('re-running analysis does not duplicate suggestions', () => {
  const dataDir = initStore();
  importFixture(dataDir);
  const first = pipeline.analyzeAndPublish({ dataDir, asOf: '2026-11-15', now: '2026-11-16T12:00:00Z' });
  const second = pipeline.analyzeAndPublish({ dataDir, asOf: '2026-11-15', now: '2026-11-16T13:00:00Z' });
  assert.ok(first.created.length >= 3);
  assert.strictEqual(second.created.length, 0);
  assert.ok(first.created.every(item => item.status === 'nova'));
  assert.ok(pipeline.loadSuggestions(pipeline.createStore(dataDir)).every(item => item.status === 'enviada'));
});

test('status updates are validated', () => {
  const list = [{ id: 'sug-1', status: 'enviada', statusHistory: [] }];
  assert.strictEqual(sugg.updateSuggestionStatus(list, 'sug-1', 'verificada', '2026-11-16')[0].status, 'verificada');
  assert.throws(() => sugg.updateSuggestionStatus(list, 'sug-1', 'publicada', '2026-11-16'), /Status inválido/);
  assert.throws(() => sugg.updateSuggestionStatus(list, 'sug-x', 'verificada', '2026-11-16'), /não encontrada/);
});

test('isoWeek handles year boundaries', () => {
  assert.strictEqual(sugg.isoWeek('2026-11-15'), '2026-W46');
  assert.strictEqual(sugg.isoWeek('2027-01-01'), '2026-W53');
});

// ---------------------------------------------------------------- performance
console.log('\nPerformance and learning:');

test('CSV with semicolons and decimal commas', () => {
  const rows = perf.parseCsv('video_id;platform;views;avg_watch_pct\ntt1;tiktok;1.200;61,5\n');
  assert.strictEqual(rows[0].videoId, 'tt1');
  const { doc } = perf.importMetrics(perf.emptyVideos(), rows, '2026-11-16T00:00:00Z');
  assert.strictEqual(doc.videos[0].metrics.avgWatchPct, 61.5);
  assert.strictEqual(doc.videos[0].metrics.views, 1200);
});

test('performance index compares against the platform baseline', () => {
  let doc = perf.emptyVideos();
  doc = perf.linkVideo(doc, { videoId: 'a', platform: 'tiktok', topicId: 'trailers', communityScore: 80 }).doc;
  doc = perf.linkVideo(doc, { videoId: 'b', platform: 'tiktok', topicId: 'trailers', communityScore: 70 }).doc;
  doc = perf.importMetrics(doc, [
    { videoId: 'a', platform: 'tiktok', views: 100000, likes: 8000 },
    { videoId: 'b', platform: 'tiktok', views: 80000, likes: 6000 },
    { videoId: 'c', platform: 'tiktok', views: 20000, likes: 600 },
    { videoId: 'd', platform: 'tiktok', views: 25000, likes: 700 }
  ], '2026-11-16T00:00:00Z').doc;
  const summary = perf.summarizePerformance(doc);
  assert.ok(summary.performanceByTopic.trailers.performanceIndex > 1);
  assert.strictEqual(summary.leaderboard.tiktok[0].topicId, 'trailers');
  assert.strictEqual(summary.communityVsOther.other.videos, 2);
  assert.strictEqual(summary.scorePredictsPerformance.spearman, null);
});

test('spearman correlation', () => {
  assert.strictEqual(perf.spearman([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]]), 1);
  assert.strictEqual(perf.spearman([[1, 5], [2, 4], [3, 3], [4, 2], [5, 1]]), -1);
  assert.strictEqual(perf.spearman([[1, 1]]), null);
});

test('linking a video converts its suggestion and feeds the growth handoff', () => {
  const dataDir = initStore();
  importFixture(dataDir);
  const first = pipeline.analyzeAndPublish({ dataDir, asOf: '2026-11-15', now: '2026-11-16T12:00:00Z' });
  const target = first.created[0];
  const video = pipeline.linkVideo({ videoId: 'tt1', platform: 'tiktok', suggestionId: target.id, title: 'x' }, { dataDir, now: '2026-11-17T12:00:00Z' });
  assert.strictEqual(video.topicId, target.topicId);
  assert.strictEqual(video.communityScoreAtSuggestion, target.communityScore);
  const stored = pipeline.loadSuggestions(pipeline.createStore(dataDir)).find(item => item.id === target.id);
  assert.strictEqual(stored.status, 'convertida');
  assert.throws(() => pipeline.linkVideo({ videoId: 'x', platform: 'instagram', topicId: 'trailers' }, { dataDir }), /Plataforma inválida/);
  assert.throws(() => pipeline.linkVideo({ videoId: 'x', platform: 'tiktok' }, { dataDir }), /--topic ou --suggestion/);
});

// ---------------------------------------------------------------- cli / dashboard
console.log('\nCLI and dashboard:');

test('dashboard escapes HTML', () => {
  assert.strictEqual(esc('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
});

test('dashboard contains all required sections', () => {
  const dataDir = initStore();
  importFixture(dataDir);
  const result = pipeline.analyzeAndPublish({ dataDir, asOf: '2026-11-15', now: '2026-11-16T12:00:00Z' });
  const html = fs.readFileSync(result.dashboard, 'utf8');
  for (const heading of ['COMMUNITY INTELLIGENCE', 'Temas mais discutidos', 'Tendências emergentes', 'Novas pautas sugeridas',
    'Histórico de assuntos', 'Pautas convertidas em vídeos', 'Desempenho dos vídeos originados das discussões']) {
    assert.ok(html.includes(heading), `missing section ${heading}`);
  }
});

test('handoffs are copied to an external handoff dir', () => {
  const dataDir = initStore();
  const inbox = tmpDir();
  importFixture(dataDir);
  pipeline.analyzeAndPublish({ dataDir, asOf: '2026-11-15', handoffDir: inbox, now: '2026-11-16T12:00:00Z' });
  assert.deepStrictEqual(fs.readdirSync(inbox).sort(), [
    'community-intelligence.growth-manager.json', 'community-intelligence.gta-scout.json', 'community-intelligence.trend-analyst.json'
  ]);
});

test('CLI argument parsing', () => {
  const { positional, flags } = cli.parseArgs(['import', 'f.txt', '--format', 'whatsapp', '--json', '--as-of=2026-11-15']);
  assert.deepStrictEqual(positional, ['import', 'f.txt']);
  assert.strictEqual(flags.format, 'whatsapp');
  assert.strictEqual(flags.json, true);
  assert.strictEqual(flags['as-of'], '2026-11-15');
  assert.throws(() => cli.parseArgs(['import', '--format']), /exige um valor/);
});

test('CLI end-to-end run returns 0', () => {
  const dataDir = tmpDir();
  const file = writeTmp(tmpDir(), 'export.txt', fixtures.buildAndroidExport());
  const original = console.log;
  console.log = () => {};
  try {
    const d = ['--data-dir', dataDir, '--now', '2026-11-16T12:00:00Z'];
    assert.strictEqual(cli.run(['init', '--consent-confirmed', '--consent-note', 'ok', ...d]), 0);
    assert.strictEqual(cli.run(['import', file, ...d]), 0);
    assert.strictEqual(cli.run(['analyze', '--as-of', '2026-11-15', ...d]), 0);
    assert.strictEqual(cli.run(['status', ...d]), 0);
    assert.strictEqual(cli.run(['imports', ...d]), 0);
    assert.strictEqual(cli.run(['suggestions', 'list', ...d]), 0);
  } finally {
    console.log = original;
  }
  const config = JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8'));
  assert.strictEqual(config.consent.confirmed, true);
});

for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });

console.log(`\nPassed: ${passed}`);
console.log(`Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
