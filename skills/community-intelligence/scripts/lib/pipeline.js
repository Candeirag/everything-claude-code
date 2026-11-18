'use strict';

/**
 * High-level operations used by the CLI (and by tests).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createStore, DEFAULT_RETENTION_DAYS, writeFileAtomic } = require('./store');
const { parseSourceFile } = require('./parser');
const privacy = require('./privacy');
const { loadTaxonomy } = require('./taxonomy');
const { analyze } = require('./analyze');
const perf = require('./performance');
const sugg = require('./suggestions');
const handoffs = require('./handoffs');
const { renderDashboard, dashboardData } = require('./dashboard');

const MAX_HISTORY_SNAPSHOTS = 104;
const DAY_MS = 24 * 60 * 60 * 1000;

function nowIso(options = {}) {
  return options.now ? new Date(options.now).toISOString() : new Date().toISOString();
}

function init(options = {}) {
  const store = createStore(options.dataDir);
  const existing = store.isInitialized() ? store.loadConfig() : null;
  if (options.consentConfirmed && !options.consentNote) {
    throw new Error('Informe --consent-note descrevendo quem autorizou e em que termos (sem dados pessoais).');
  }
  const at = nowIso(options);
  const config = {
    schemaVersion: 1,
    createdAt: existing ? existing.createdAt : at,
    groupLabel: options.groupLabel || (existing && existing.groupLabel) || 'Grupo de networking',
    salt: existing ? existing.salt : privacy.generateSalt(),
    retentionDays: Number(options.retentionDays || (existing && existing.retentionDays) || DEFAULT_RETENTION_DAYS),
    handoffDir: options.handoffDir || (existing && existing.handoffDir) || null,
    optOut: existing ? existing.optOut || [] : [],
    trainingUse: 'prohibited',
    consent: options.consentConfirmed
      ? { confirmed: true, confirmedAt: at, note: options.consentNote }
      : (existing && existing.consent) || { confirmed: false }
  };
  if (!Number.isFinite(config.retentionDays) || config.retentionDays < 1) {
    throw new Error('--retention-days deve ser um número positivo');
  }
  store.saveConfig(config);
  return { store, config };
}

function messageId(ts, author, text) {
  return crypto.createHash('sha256').update(`${ts}|${author}|${text}`).digest('hex').slice(0, 16);
}

function importFile(filePath, options = {}) {
  const store = createStore(options.dataDir);
  const config = store.loadConfig();
  privacy.assertConsent(config);
  if (!fs.existsSync(filePath)) throw new Error(`Arquivo não encontrado: ${filePath}`);

  const parsed = parseSourceFile(filePath, { format: options.format, dateOrder: options.dateOrder });
  const authorNames = Array.from(new Set(parsed.messages.map(message => message.author)));
  privacy.assertGroupConversation(authorNames.length);

  const optOut = new Set(config.optOut || []);
  const redact = privacy.buildRedactor(authorNames);
  const retentionCutoff = Date.parse(nowIso(options)) - config.retentionDays * DAY_MS;
  const known = store.knownMessageIds();
  const at = nowIso(options);
  const importId = `imp-${at.replace(/[-:T]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}`;

  const counters = { optedOut: 0, expired: 0, duplicates: 0 };
  const stored = [];
  for (const message of parsed.messages) {
    const author = privacy.pseudonymize(message.author, config.salt);
    if (optOut.has(author)) { counters.optedOut++; continue; }
    if (Date.parse(`${message.timestamp}Z`) < retentionCutoff) { counters.expired++; continue; }
    const text = redact(message.text);
    const id = messageId(message.timestamp, author, text);
    if (known.has(id)) { counters.duplicates++; continue; }
    known.add(id);
    stored.push({ id, importId, ts: message.timestamp, author, text });
  }

  const timestamps = stored.map(message => message.ts).sort();
  const manifest = {
    id: importId,
    importedAt: at,
    format: parsed.format,
    sourceLabel: options.label || null,
    sha256: crypto.createHash('sha256').update(parsed.buffer).digest('hex'),
    dateOrder: parsed.dateOrder,
    parseStats: parsed.stats,
    ignoredArchiveEntries: parsed.ignoredArchiveEntries || 0,
    participants: authorNames.length,
    period: timestamps.length ? { from: timestamps[0].slice(0, 10), to: timestamps[timestamps.length - 1].slice(0, 10) } : null,
    storedMessages: stored.length,
    skipped: counters,
    trainingUse: 'prohibited'
  };
  store.saveImport(manifest, stored);
  return manifest;
}

function applyRetention(store, config, options = {}) {
  const cutoff = Date.parse(nowIso(options)) - config.retentionDays * DAY_MS;
  return store.removeMessagesWhere(message => Date.parse(`${message.ts}Z`) < cutoff);
}

function loadSuggestions(store) {
  return store.readJson('suggestions.json', { schemaVersion: 1, suggestions: [] }).suggestions;
}

function saveSuggestions(store, list) {
  store.writeJson('suggestions.json', { schemaVersion: 1, trainingUse: 'not-applicable', suggestions: list });
}

function loadVideos(store) {
  return store.readJson('videos.json', perf.emptyVideos());
}

function upsertSnapshot(history, analysis, generatedAt) {
  const snapshot = {
    asOf: analysis.asOf,
    windowDays: analysis.windowDays,
    generatedAt,
    topics: analysis.ranking.map(row => ({
      topicId: row.id,
      label: row.label,
      score: row.score,
      messages: row.current.messages,
      participants: row.current.authors,
      confidence: row.confidence
    }))
  };
  const others = history.filter(item => !(item.asOf === analysis.asOf && item.windowDays === analysis.windowDays));
  return [...others, snapshot].sort((a, b) => a.asOf.localeCompare(b.asOf)).slice(-MAX_HISTORY_SNAPSHOTS);
}

function writeHandoffs(store, config, payloads, options) {
  const written = [];
  const targets = [store.paths.handoffs];
  const extra = options.handoffDir || config.handoffDir;
  if (extra) targets.push(path.resolve(extra));
  for (const [consumer, payload] of Object.entries(payloads)) {
    for (const dir of targets) {
      const file = path.join(dir, `community-intelligence.${consumer}.json`);
      writeFileAtomic(file, `${JSON.stringify(payload, null, 2)}\n`);
      written.push(file);
    }
  }
  return written;
}

/**
 * Analyze stored messages, generate suggestions, write handoffs and dashboard.
 * options.refreshOnly: re-render outputs without new suggestions or snapshots.
 */
function analyzeAndPublish(options = {}) {
  const store = createStore(options.dataDir);
  const config = store.loadConfig();
  const generatedAt = nowIso(options);
  const expired = applyRetention(store, config, options);

  const messages = store.loadAllMessages();
  const taxonomy = loadTaxonomy(store.root);
  const performance = perf.summarizePerformance(loadVideos(store));
  const analysis = analyze({
    messages,
    taxonomy,
    asOf: options.asOf,
    windowDays: Number(options.windowDays || 7),
    performanceByTopic: performance.performanceByTopic,
    weights: config.weights
  });

  const opportunities = sugg.findOpportunities(analysis.ranking, performance.videos, performance.performanceByTopic, analysis.asOf);

  let suggestions = loadSuggestions(store);
  let created = [];
  let topicHistory = store.readJson('history.json', { snapshots: [] }).snapshots;
  if (!options.refreshOnly) {
    const generated = sugg.generateSuggestions({
      ranking: analysis.ranking,
      emergingTrends: analysis.emergingTrends,
      opportunities,
      existing: suggestions,
      asOf: analysis.asOf,
      limit: Number(options.limit || 5)
    });
    created = generated.created;
    suggestions = generated.all;
    topicHistory = upsertSnapshot(topicHistory, analysis, generatedAt);
    store.writeJson('history.json', { schemaVersion: 1, trainingUse: 'not-applicable', snapshots: topicHistory });
  }

  const payloads = {
    'gta-scout': handoffs.buildScoutHandoff({ analysis, suggestions, generatedAt }),
    'trend-analyst': handoffs.buildTrendHandoff({ analysis, opportunities, generatedAt }),
    'growth-manager': handoffs.buildGrowthHandoff({ analysis, performance, opportunities, topicHistory, generatedAt })
  };
  const handoffFiles = writeHandoffs(store, config, payloads, options);

  if (!options.refreshOnly) {
    const createdIds = new Set(created.map(item => item.id));
    suggestions = suggestions.map(item => (createdIds.has(item.id)
      ? { ...item, status: 'enviada', statusHistory: [...item.statusHistory, { status: 'enviada', at: analysis.asOf, note: 'handoff gta-scout + trend-analyst' }] }
      : item));
    saveSuggestions(store, suggestions);
  }

  const dashboardInput = {
    analysis, suggestions, performance, opportunities, topicHistory,
    imports: store.listImports(), config, generatedAt
  };
  store.writeFile(path.join('dashboard', 'index.html'), renderDashboard(dashboardInput));
  store.writeJson(path.join('dashboard', 'data.json'), dashboardData(dashboardInput));

  return {
    analysis,
    opportunities,
    created,
    suggestions,
    performance,
    handoffFiles,
    expiredRemoved: expired,
    dashboard: path.join(store.paths.dashboard, 'index.html')
  };
}

function optOut(name, options = {}) {
  if (!name || !String(name).trim()) throw new Error('Informe --name com o nome exibido na exportação');
  const store = createStore(options.dataDir);
  const config = store.loadConfig();
  const pseudonym = privacy.pseudonymize(name, config.salt);
  const set = new Set(config.optOut || []);
  set.add(pseudonym);
  store.saveConfig({ ...config, optOut: Array.from(set) });
  const removed = store.removeMessagesWhere(message => message.author === pseudonym);
  return { removed };
}

function purge(options = {}) {
  const store = createStore(options.dataDir);
  if (!options.yes) throw new Error('Exclusão exige confirmação explícita: adicione --yes');
  if (options.all) {
    store.purgeAll();
    return { scope: 'all', root: store.root };
  }
  const config = store.loadConfig();
  let result;
  if (options.importId) {
    const existed = store.deleteImport(options.importId);
    if (!existed) throw new Error(`Importação não encontrada: ${options.importId}`);
    result = { scope: 'import', importId: options.importId };
  } else if (options.olderThanDays) {
    const days = Number(options.olderThanDays);
    if (!Number.isFinite(days) || days < 0) throw new Error('--older-than deve ser um número de dias');
    const cutoff = Date.parse(nowIso(options)) - days * DAY_MS;
    result = { scope: 'older-than', removed: store.removeMessagesWhere(message => Date.parse(`${message.ts}Z`) < cutoff) };
  } else {
    throw new Error('Use --import <id>, --older-than <dias> ou --all');
  }
  if (store.listImports().length > 0 && fs.existsSync(path.join(store.paths.dashboard, 'index.html'))) {
    analyzeAndPublish({ ...options, refreshOnly: true });
  } else {
    fs.rmSync(store.paths.dashboard, { recursive: true, force: true });
  }
  return { ...result, config: { retentionDays: config.retentionDays } };
}

function linkVideo(input, options = {}) {
  const store = createStore(options.dataDir);
  store.loadConfig();
  let suggestions = loadSuggestions(store);
  let communityScore = input.communityScore;
  let topicId = input.topicId;
  if (input.suggestionId) {
    const suggestion = suggestions.find(item => item.id === input.suggestionId);
    if (!suggestion) throw new Error(`Sugestão não encontrada: ${input.suggestionId}`);
    topicId = topicId || suggestion.topicId;
    if (communityScore === undefined || communityScore === null) communityScore = suggestion.communityScore;
    if (suggestion.status !== 'convertida') {
      suggestions = sugg.updateSuggestionStatus(suggestions, suggestion.id, 'convertida', nowIso(options).slice(0, 10), `vídeo ${input.platform}:${input.videoId}`);
      saveSuggestions(store, suggestions);
    }
  }
  if (!topicId) throw new Error('Informe --topic ou --suggestion para vincular o vídeo a um tema da comunidade');
  const { doc, video } = perf.linkVideo(loadVideos(store), { ...input, topicId, communityScore });
  store.writeJson('videos.json', doc);
  return video;
}

function importMetrics(filePath, options = {}) {
  const store = createStore(options.dataDir);
  store.loadConfig();
  const records = perf.readMetricsFile(filePath);
  const { doc, updated } = perf.importMetrics(loadVideos(store), records, nowIso(options));
  store.writeJson('videos.json', doc);
  return { updated };
}

function setSuggestionStatus(id, status, options = {}) {
  const store = createStore(options.dataDir);
  store.loadConfig();
  const updated = sugg.updateSuggestionStatus(loadSuggestions(store), id, status, nowIso(options).slice(0, 10), options.note);
  saveSuggestions(store, updated);
  return updated.find(item => item.id === id);
}

function status(options = {}) {
  const store = createStore(options.dataDir);
  if (!store.isInitialized()) return { initialized: false, root: store.root };
  const config = store.loadConfig();
  const imports = store.listImports();
  const messages = store.loadAllMessages();
  const suggestions = loadSuggestions(store);
  return {
    initialized: true,
    root: store.root,
    groupLabel: config.groupLabel,
    consent: config.consent,
    retentionDays: config.retentionDays,
    optOuts: (config.optOut || []).length,
    imports: imports.length,
    messages: messages.length,
    period: messages.length ? { from: messages[0].ts.slice(0, 10), to: messages[messages.length - 1].ts.slice(0, 10) } : null,
    suggestions: suggestions.reduce((acc, item) => ({ ...acc, [item.status]: (acc[item.status] || 0) + 1 }), {}),
    videos: loadVideos(store).videos.length
  };
}

module.exports = {
  init,
  importFile,
  analyzeAndPublish,
  optOut,
  purge,
  linkVideo,
  importMetrics,
  setSuggestionStatus,
  status,
  loadSuggestions,
  createStore
};
