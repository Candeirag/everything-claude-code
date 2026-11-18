#!/usr/bin/env -S node --no-warnings
// CLI operacional do GTA 6 Autopilot (Fase 1: integração ViceScale).

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { createAdapter, createCutProAdapter } from '../src/config.js';

const HELP = `Uso: autopilot <comando> [opções]

ViceScale
  status                       Estado da integração (saúde, cotas, alertas, fila da ponte)
  catalog                      Ferramentas MCP do catálogo, com risco e cota
  capabilities                 Capacidades do Autopilot e disponibilidade via MCP
  discover                     tools/list no servidor (transporte http) e diff com o catálogo
  health                       Verifica a conta (enfileira "status" no modo ponte)
  run <capacidade> [--input JSON] [--key IDEMPOTENCIA] [--rights-cleared]
  operations [--state S]       Últimas operações
  audit [--limit N]            Últimos eventos de auditoria
  emergency-stop on|off        Suspende/retoma TODAS as publicações

Cut.Pro (plataforma principal; exige CUTPRO_API_KEY)
  cutpro status | health | capabilities | catalog
  cutpro run <capacidade> [--input JSON] [--key IDEMPOTENCIA] [--rights-cleared] [--confirm-destructive]

Ponte Claude (usado pelo comando /vicescale-worker numa sessão com o conector ViceScale)
  bridge:claim                 Próxima operação enfileirada (JSON) e marca como dispatched
  bridge:complete <id> (--text T | --text-file F)
  bridge:fail <id> --error MSG [--auth]
`;

const print = (value) => console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));

const main = async () => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      input: { type: 'string' },
      key: { type: 'string' },
      'rights-cleared': { type: 'boolean' },
      state: { type: 'string' },
      limit: { type: 'string' },
      text: { type: 'string' },
      'text-file': { type: 'string' },
      error: { type: 'string' },
      auth: { type: 'boolean' },
      'confirm-destructive': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [command, arg] = positionals;
  if (!command || values.help) return print(HELP);

  if (command === 'cutpro') return runCutPro(positionals.slice(1), values);

  const { adapter, store } = createAdapter();
  try {
    switch (command) {
      case 'status':
        return print(adapter.status());
      case 'catalog':
        return print(adapter.catalog.tools.map(({ name, risk, quotaBucket, summary }) => ({ name, risk, quotaBucket, summary })));
      case 'capabilities':
        return print(adapter.listCapabilities());
      case 'discover':
        return print(await adapter.discover());
      case 'health':
        return print(await adapter.checkHealth());
      case 'run': {
        if (!arg) throw new Error('Informe a capacidade. Ex.: autopilot run post.list --input \'{"limit":5}\'');
        const outcome = await adapter.run(arg, values.input ? JSON.parse(values.input) : {}, {
          idempotencyKey: values.key,
          context: { rightsCleared: values['rights-cleared'] === true },
        });
        return print({ state: outcome.state, reused: outcome.reused ?? false, operation: outcome.operation });
      }
      case 'operations':
        return print(store.listOperations({ state: values.state, limit: Number(values.limit ?? 20) }));
      case 'audit':
        return print(store.listAudit({ limit: Number(values.limit ?? 30) }));
      case 'emergency-stop':
        if (arg !== 'on' && arg !== 'off') throw new Error('Use: emergency-stop on|off');
        adapter.setEmergencyStop(arg === 'on');
        return print({ emergencyStop: arg === 'on' });
      case 'bridge:claim': {
        const operation = adapter.claimBridgedOperation();
        return print(operation ? { id: operation.id, mcpTool: `mcp__ViceScale__${operation.tool}`, args: operation.args, risk: operation.risk } : { empty: true });
      }
      case 'bridge:complete': {
        const text = values['text-file'] ? readFileSync(values['text-file'], 'utf8') : values.text;
        if (!arg || text === undefined) throw new Error('Use: bridge:complete <id> --text "..." | --text-file arquivo');
        const op = adapter.completeBridgedOperation(arg, { text });
        return print({ id: op.id, state: op.state });
      }
      case 'bridge:fail': {
        if (!arg || !values.error) throw new Error('Use: bridge:fail <id> --error "mensagem" [--auth]');
        const op = adapter.completeBridgedOperation(arg, { error: values.error, authError: values.auth === true });
        return print({ id: op.id, state: op.state });
      }
      default:
        print(HELP);
        process.exitCode = 1;
    }
  } finally {
    store.close();
  }
};

const runCutPro = async ([sub, arg], values) => {
  const { adapter, store } = createCutProAdapter();
  try {
    switch (sub) {
      case 'status':
        return print(adapter.status());
      case 'health':
        return print(await adapter.checkHealth());
      case 'capabilities':
        return print(adapter.listCapabilities());
      case 'catalog':
        return print(adapter.catalog.tools.map(({ name, method, path, risk, quotaBucket }) => ({ name, method, path, risk, quotaBucket })));
      case 'run': {
        if (!arg) throw new Error('Informe a capacidade. Ex.: autopilot cutpro run account.connections');
        const outcome = await adapter.run(arg, values.input ? JSON.parse(values.input) : {}, {
          idempotencyKey: values.key,
          context: { rightsCleared: values['rights-cleared'] === true, confirmDestructive: values['confirm-destructive'] === true },
        });
        return print({ state: outcome.state, reused: outcome.reused ?? false, operation: outcome.operation });
      }
      default:
        print(HELP);
        process.exitCode = 1;
    }
  } finally {
    store.close();
  }
};

main().catch((error) => {
  console.error(`[${error.code ?? 'ERRO'}] ${error.message}`);
  if (error.alternative) console.error(`Alternativa: ${error.alternative}`);
  process.exitCode = 1;
});
