'use strict';

/**
 * File-based storage for Community Intelligence.
 *
 * <data-dir>/
 *   config.json                consent record, pseudonymization salt, opt-outs, retention
 *   imports/<id>.json          import manifest (no file name, no participant names)
 *   messages/<id>.jsonl        minimized messages: pseudonym, timestamp, redacted text, signals
 *   history.json               per-analysis topic snapshots (aggregates only)
 *   suggestions.json           video suggestions and their pipeline status
 *   videos.json                published videos linked to topics + platform metrics
 *   handoffs/*.json            payloads for GTA Scout, Trend Analyst, Growth Manager
 *   dashboard/index.html       COMMUNITY INTELLIGENCE section (static)
 *   dashboard/data.json        same data for embedding in another dashboard
 *
 * Every file carries "trainingUse": "prohibited" where personal-derived data exists.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_DIR = path.join('.gta6-autopilot', 'community-intelligence');
const DEFAULT_RETENTION_DAYS = 180;

function resolveDataDir(explicit) {
  const chosen = explicit || process.env.GTA6_COMMUNITY_DATA_DIR || path.join(process.cwd(), DEFAULT_DIR);
  return path.resolve(chosen);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

function writeFileAtomic(filePath, content) {
  ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, content, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tmp, filePath);
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createStore(dataDir) {
  const root = resolveDataDir(dataDir);
  const paths = {
    root,
    config: path.join(root, 'config.json'),
    imports: path.join(root, 'imports'),
    messages: path.join(root, 'messages'),
    history: path.join(root, 'history.json'),
    suggestions: path.join(root, 'suggestions.json'),
    videos: path.join(root, 'videos.json'),
    handoffs: path.join(root, 'handoffs'),
    dashboard: path.join(root, 'dashboard')
  };

  function isInitialized() {
    return fs.existsSync(paths.config);
  }

  function loadConfig() {
    const config = readJson(paths.config, null);
    if (!config) {
      throw new Error(`Diretório não inicializado: ${root}. Rode "init" primeiro.`);
    }
    return config;
  }

  function saveConfig(config) {
    writeJson(paths.config, config);
  }

  function listImports() {
    if (!fs.existsSync(paths.imports)) return [];
    return fs.readdirSync(paths.imports)
      .filter(name => name.endsWith('.json'))
      .map(name => readJson(path.join(paths.imports, name), null))
      .filter(Boolean)
      .sort((a, b) => String(a.importedAt).localeCompare(String(b.importedAt)));
  }

  function saveImport(manifest, messages) {
    ensureDir(paths.messages);
    const lines = messages.map(message => JSON.stringify(message)).join('\n');
    writeFileAtomic(path.join(paths.messages, `${manifest.id}.jsonl`), lines ? `${lines}\n` : '');
    writeJson(path.join(paths.imports, `${manifest.id}.json`), manifest);
  }

  function readImportMessages(importId) {
    const file = path.join(paths.messages, `${importId}.jsonl`);
    if (!fs.existsSync(file)) return [];
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  }

  function rewriteImportMessages(importId, messages) {
    const manifestPath = path.join(paths.imports, `${importId}.json`);
    const manifest = readJson(manifestPath, null);
    if (!manifest) return;
    if (messages.length === 0) {
      deleteImport(importId);
      return;
    }
    saveImport({ ...manifest, storedMessages: messages.length }, messages);
  }

  /** All stored messages, de-duplicated across overlapping periodic exports. */
  function loadAllMessages() {
    const byId = new Map();
    for (const manifest of listImports()) {
      for (const message of readImportMessages(manifest.id)) {
        if (!byId.has(message.id)) byId.set(message.id, message);
      }
    }
    return Array.from(byId.values()).sort((a, b) => a.ts.localeCompare(b.ts));
  }

  function knownMessageIds() {
    return new Set(loadAllMessages().map(message => message.id));
  }

  function deleteImport(importId) {
    if (!/^[a-z0-9-]+$/i.test(importId)) throw new Error(`ID de importação inválido: ${importId}`);
    const manifestPath = path.join(paths.imports, `${importId}.json`);
    const messagesPath = path.join(paths.messages, `${importId}.jsonl`);
    const existed = fs.existsSync(manifestPath) || fs.existsSync(messagesPath);
    fs.rmSync(manifestPath, { force: true });
    fs.rmSync(messagesPath, { force: true });
    return existed;
  }

  /** Remove every message matching predicate; returns how many were removed. */
  function removeMessagesWhere(predicate) {
    let removed = 0;
    for (const manifest of listImports()) {
      const messages = readImportMessages(manifest.id);
      const kept = messages.filter(message => !predicate(message));
      if (kept.length !== messages.length) {
        removed += messages.length - kept.length;
        rewriteImportMessages(manifest.id, kept);
      }
    }
    return removed;
  }

  function purgeAll() {
    fs.rmSync(root, { recursive: true, force: true });
  }

  return {
    root,
    paths,
    isInitialized,
    loadConfig,
    saveConfig,
    listImports,
    saveImport,
    readImportMessages,
    loadAllMessages,
    knownMessageIds,
    deleteImport,
    removeMessagesWhere,
    purgeAll,
    readJson: (name, fallback) => readJson(path.join(root, name), fallback),
    writeJson: (name, value) => writeJson(path.join(root, name), value),
    writeFile: (name, content) => writeFileAtomic(path.join(root, name), content)
  };
}

module.exports = {
  DEFAULT_DIR,
  DEFAULT_RETENTION_DAYS,
  resolveDataDir,
  createStore,
  writeFileAtomic
};
