#!/usr/bin/env node
// Gera src/cutpro/catalog.json a partir do contrato oficial da Cut.Pro
// (https://api.cut.pro/api/v1/openapi.json). Só as operações que o Autopilot
// usa entram no catálogo, cada uma com o risco classificado aqui.
//
// Uso: node scripts/sync-cutpro-catalog.js caminho/para/openapi.json

import { readFileSync, writeFileSync } from 'node:fs';

// risk: read | write (muda estado sem custo) | quota (gasta créditos/cria job)
//       | publish (sai na rede social) | destructive (apaga, inclusive da rede)
// requiresRights: processa material de terceiros -> exige direitos registrados
const OPERATIONS = {
  getWorkspace: { risk: 'read' },
  analyzeVideo: { risk: 'read', quotaBucket: 'analyze', note: 'POST sem custo; limite 10/min' },
  createSubmission: { risk: 'quota', quotaBucket: 'clip_submissions', requiresRights: true },
  retrySubmission: { risk: 'quota', quotaBucket: 'clip_submissions', requiresRights: true },
  getSubmission: { risk: 'read' },
  listSubmissions: { risk: 'read' },
  deleteSubmission: { risk: 'destructive' },
  listClips: { risk: 'read' },
  listClipIds: { risk: 'read' },
  downloadClipSubtitles: { risk: 'read' },
  suggestClipTitles: { risk: 'quota', quotaBucket: 'title_suggestions', note: 'grátis; 60/h por workspace' },
  renameClip: { risk: 'write' },
  rateClip: { risk: 'write' },
  applyTemplate: { risk: 'quota', quotaBucket: 'renders' },
  renderClip: { risk: 'quota', quotaBucket: 'renders' },
  createRender: { risk: 'quota', quotaBucket: 'renders' },
  getRender: { risk: 'read' },
  downloadRender: { risk: 'read' },
  getRenderLimits: { risk: 'read' },
  listTemplates: { risk: 'read' },
  listStrategies: { risk: 'read' },
  createStrategy: { risk: 'write' },
  updateStrategy: { risk: 'write' },
  searchChannels: { risk: 'read', note: 'limite 30/min' },
  discoverLives: { risk: 'read', note: 'até 6 canais ao vivo, favorece português' },
  listMonitors: { risk: 'read' },
  getMonitor: { risk: 'read' },
  createMonitor: { risk: 'quota', quotaBucket: 'monitors', requiresRights: true, note: 'limite 10/min' },
  updateMonitor: { risk: 'write' },
  startMonitor: { risk: 'quota', quotaBucket: 'monitors', requiresRights: true, note: 'live cobra por bloco de 10 min' },
  stopMonitor: { risk: 'write' },
  listBroadcasts: { risk: 'read' },
  listBroadcastClips: { risk: 'read' },
  renderBroadcastClip: { risk: 'quota', quotaBucket: 'renders' },
  createVideoUpload: { risk: 'write' },
  completeVideoUpload: { risk: 'write' },
  listConnections: { risk: 'read' },
  getConnectionLink: { risk: 'read' },
  writePostDescription: { risk: 'quota', quotaBucket: 'descriptions', note: '0-1 crédito' },
  getPostUsage: { risk: 'read' },
  getPostAvailability: { risk: 'read' },
  getBestPostTime: { risk: 'read' },
  createPost: { risk: 'publish', quotaBucket: 'posts', requiresRights: true },
  getPost: { risk: 'read' },
  listPosts: { risk: 'read' },
  updatePost: { risk: 'publish' },
  reschedulePostItems: { risk: 'publish' },
  publishPost: { risk: 'publish' },
  retryPostItem: { risk: 'publish' },
  cancelPost: { risk: 'write', note: 'só cancela o que ainda não saiu; permitido mesmo com emergência' },
  deletePostItem: { risk: 'destructive', note: 'item publicado: APAGA o vídeo da rede' },
};

const DROP_KEYS = new Set(['example', 'examples', 'title', 'readOnly', 'writeOnly', 'deprecated', 'x-order']);

const main = () => {
  const [specPath] = process.argv.slice(2);
  if (!specPath) throw new Error('Uso: node scripts/sync-cutpro-catalog.js openapi.json');
  const spec = JSON.parse(readFileSync(specPath, 'utf8'));

  const deref = (node, seen = new Set()) => {
    if (Array.isArray(node)) return node.map((n) => deref(n, seen));
    if (!node || typeof node !== 'object') return node;
    if (node.$ref) {
      const name = node.$ref.split('/').pop();
      if (seen.has(name)) return {};
      const next = new Set(seen).add(name);
      const section = node.$ref.includes('/parameters/') ? spec.components.parameters : spec.components.schemas;
      return deref(section[name], next);
    }
    return Object.fromEntries(
      Object.entries(node)
        .filter(([k]) => !DROP_KEYS.has(k))
        .map(([k, v]) => [k, k === 'description' ? undefined : deref(v, seen)])
        .filter(([, v]) => v !== undefined),
    );
  };

  const operations = [];
  const found = new Set();
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(methods)) {
      const meta = OPERATIONS[op?.operationId];
      if (!meta) continue;
      found.add(op.operationId);
      const params = (op.parameters ?? []).map((p) => deref(p));
      const properties = {};
      const required = [];
      const pathParams = [];
      const queryParams = [];
      for (const p of params) {
        if (p.in !== 'path' && p.in !== 'query') continue;
        properties[p.name] = p.schema ?? { type: 'string' };
        if (p.required) required.push(p.name);
        (p.in === 'path' ? pathParams : queryParams).push(p.name);
      }
      const body = op.requestBody?.content?.['application/json']?.schema;
      if (body) {
        properties.body = deref(body);
        if (op.requestBody.required) required.push('body');
      }
      operations.push({
        name: op.operationId,
        method: method.toUpperCase(),
        path,
        summary: op.summary ?? '',
        risk: meta.risk,
        quotaBucket: meta.quotaBucket ?? null,
        requiresRights: meta.requiresRights ?? false,
        note: meta.note,
        pathParams,
        queryParams,
        inputSchema: { type: 'object', additionalProperties: false, properties, required },
      });
    }
  }

  const missing = Object.keys(OPERATIONS).filter((name) => !found.has(name));
  const catalog = {
    server: 'Cut.Pro API v1',
    baseUrl: spec.servers?.[0]?.url ?? 'https://api.cut.pro/api/v1',
    specVersion: spec.info?.version,
    capturedAt: new Date().toISOString().slice(0, 10),
    source: 'Gerado por scripts/sync-cutpro-catalog.js a partir do openapi.json oficial. Não editar à mão.',
    missingFromSpec: missing,
    tools: operations.sort((a, b) => a.name.localeCompare(b.name)),
  };
  const out = new URL('../src/cutpro/catalog.json', import.meta.url);
  writeFileSync(out, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`${operations.length} operações gravadas em src/cutpro/catalog.json`);
  if (missing.length) console.log(`Ausentes no contrato: ${missing.join(', ')}`);
};

main();
