// Persistência local com o SQLite nativo do Node (node:sqlite, Node >= 22.5).
// A interface pública deste módulo é o contrato que a versão Postgres (Fase 5,
// produção em nuvem) deverá implementar.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE,
  capability TEXT,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  risk TEXT NOT NULL,
  state TEXT NOT NULL,
  result_json TEXT,
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS operations_state ON operations(state, created_at);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  event TEXT NOT NULL,
  tool TEXT,
  operation_id TEXT,
  detail_json TEXT
);
CREATE TABLE IF NOT EXISTS health_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms INTEGER,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS catalog_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  source TEXT NOT NULL,
  tools_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS quota_usage (
  day TEXT NOT NULL,
  bucket TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, bucket)
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

const parse = (text) => (text == null ? null : JSON.parse(text));

const rowToOperation = (row) =>
  row && {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    capability: row.capability,
    tool: row.tool,
    args: parse(row.args_json),
    risk: row.risk,
    state: row.state,
    result: parse(row.result_json),
    error: row.error,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };

export class SqliteStore {
  constructor(path = ':memory:', { now = () => new Date() } = {}) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec(SCHEMA);
    this.now = now;
  }

  #ts() {
    return this.now().toISOString();
  }

  // ---- operations -------------------------------------------------------
  createOperation({ idempotencyKey = null, capability = null, tool, args, risk, state }) {
    const id = randomUUID();
    const ts = this.#ts();
    this.db
      .prepare(
        `INSERT INTO operations (id, idempotency_key, capability, tool, args_json, risk, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, idempotencyKey, capability, tool, JSON.stringify(args), risk, state, ts, ts);
    return this.getOperation(id);
  }

  getOperation(id) {
    return rowToOperation(this.db.prepare('SELECT * FROM operations WHERE id = ?').get(id));
  }

  findOperationByKey(idempotencyKey) {
    return rowToOperation(this.db.prepare('SELECT * FROM operations WHERE idempotency_key = ?').get(idempotencyKey));
  }

  updateOperation(id, { state, result, error, incrementAttempts = false }) {
    const current = this.getOperation(id);
    if (!current) throw new Error(`Operação ${id} não encontrada`);
    this.db
      .prepare(
        `UPDATE operations SET state = ?, result_json = ?, error = ?, attempts = attempts + ?, updated_at = ? WHERE id = ?`,
      )
      .run(
        state ?? current.state,
        result === undefined ? JSON.stringify(current.result) : JSON.stringify(result),
        error === undefined ? current.error : error,
        incrementAttempts ? 1 : 0,
        this.#ts(),
        id,
      );
    return this.getOperation(id);
  }

  /** Marca a operação enfileirada mais antiga como "dispatched" e a retorna (atômico). */
  claimNextQueued() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.db
        .prepare(`SELECT * FROM operations WHERE state = 'queued' ORDER BY created_at, rowid LIMIT 1`)
        .get();
      if (!row) {
        this.db.exec('COMMIT');
        return null;
      }
      this.db
        .prepare(`UPDATE operations SET state = 'dispatched', attempts = attempts + 1, updated_at = ? WHERE id = ?`)
        .run(this.#ts(), row.id);
      this.db.exec('COMMIT');
      return this.getOperation(row.id);
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  listOperations({ state, limit = 50 } = {}) {
    const rows = state
      ? this.db.prepare('SELECT * FROM operations WHERE state = ? ORDER BY created_at DESC LIMIT ?').all(state, limit)
      : this.db.prepare('SELECT * FROM operations ORDER BY created_at DESC LIMIT ?').all(limit);
    return rows.map(rowToOperation);
  }

  // ---- audit ------------------------------------------------------------
  audit(event, { tool = null, operationId = null, detail = null } = {}) {
    this.db
      .prepare('INSERT INTO audit_log (ts, event, tool, operation_id, detail_json) VALUES (?, ?, ?, ?, ?)')
      .run(this.#ts(), event, tool, operationId, detail == null ? null : JSON.stringify(detail));
  }

  listAudit({ limit = 50 } = {}) {
    return this.db
      .prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?')
      .all(limit)
      .map((r) => ({ ...r, detail: parse(r.detail_json), detail_json: undefined }));
  }

  // ---- health -----------------------------------------------------------
  recordHealth({ ok, latencyMs = null, detail = null }) {
    this.db
      .prepare('INSERT INTO health_checks (ts, ok, latency_ms, detail) VALUES (?, ?, ?, ?)')
      .run(this.#ts(), ok ? 1 : 0, latencyMs, detail);
  }

  lastHealth() {
    const row = this.db.prepare('SELECT * FROM health_checks ORDER BY id DESC LIMIT 1').get();
    return row ? { ts: row.ts, ok: row.ok === 1, latencyMs: row.latency_ms, detail: row.detail } : null;
  }

  // ---- catalog ----------------------------------------------------------
  saveCatalogSnapshot(source, tools) {
    this.db
      .prepare('INSERT INTO catalog_snapshots (ts, source, tools_json) VALUES (?, ?, ?)')
      .run(this.#ts(), source, JSON.stringify(tools));
  }

  lastCatalogSnapshot() {
    const row = this.db.prepare('SELECT * FROM catalog_snapshots ORDER BY id DESC LIMIT 1').get();
    return row ? { ts: row.ts, source: row.source, tools: parse(row.tools_json) } : null;
  }

  // ---- quotas -----------------------------------------------------------
  #day() {
    return this.#ts().slice(0, 10);
  }

  quotaUsed(bucket) {
    const row = this.db.prepare('SELECT count FROM quota_usage WHERE day = ? AND bucket = ?').get(this.#day(), bucket);
    return row?.count ?? 0;
  }

  incrementQuota(bucket) {
    this.db
      .prepare(
        `INSERT INTO quota_usage (day, bucket, count) VALUES (?, ?, 1)
         ON CONFLICT(day, bucket) DO UPDATE SET count = count + 1`,
      )
      .run(this.#day(), bucket);
  }

  // ---- settings ---------------------------------------------------------
  getSetting(key, fallback = null) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : fallback;
  }

  setSetting(key, value) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  close() {
    this.db.close();
  }
}
