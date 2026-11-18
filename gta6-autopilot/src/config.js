// Configuração lida do ambiente. Segredos (VICESCALE_MCP_TOKEN) vêm só do
// ambiente/secret manager — nunca do repositório, do frontend ou de logs.

import { resolve } from 'node:path';
import { DEFAULT_QUOTAS, ViceScaleMCPAdapter } from './vicescale/adapter.js';
import { ClaudeBridgeTransport } from './vicescale/transports/bridge.js';
import { HttpMcpTransport } from './vicescale/transports/http.js';
import { SqliteStore } from './store/sqlite-store.js';

export const loadConfig = (env = process.env) => ({
  transport: env.VICESCALE_TRANSPORT ?? 'bridge',
  mcpUrl: env.VICESCALE_MCP_URL ?? null,
  mcpToken: env.VICESCALE_MCP_TOKEN ?? null,
  dbPath: env.AUTOPILOT_DB ?? resolve(process.cwd(), 'data/autopilot.db'),
  dryRun: env.AUTOPILOT_DRY_RUN ?? 'publish',
  timezone: env.AUTOPILOT_TIMEZONE ?? 'America/Sao_Paulo',
  quotas: env.AUTOPILOT_QUOTAS_JSON ? { ...DEFAULT_QUOTAS, ...JSON.parse(env.AUTOPILOT_QUOTAS_JSON) } : DEFAULT_QUOTAS,
});

export const createTransport = (config) => {
  if (config.transport === 'http') return new HttpMcpTransport({ url: config.mcpUrl, token: config.mcpToken });
  if (config.transport === 'bridge') return new ClaudeBridgeTransport();
  throw new Error(`VICESCALE_TRANSPORT inválido: ${config.transport} (use "bridge" ou "http")`);
};

export const createAdapter = (config = loadConfig()) => {
  const store = new SqliteStore(config.dbPath);
  const adapter = new ViceScaleMCPAdapter({
    transport: createTransport(config),
    store,
    dryRun: config.dryRun,
    quotas: config.quotas,
  });
  return { adapter, store, config };
};
