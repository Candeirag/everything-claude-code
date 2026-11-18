#!/usr/bin/env node
'use strict';

/**
 * Community Intelligence (GTA 6 Autopilot, módulo 9) — CLI
 *
 * Usage: node community-intel.js <command> [options]
 * Run with "help" for the full command list.
 */

const pipeline = require('./lib/pipeline');

const HELP = `Community Intelligence — GTA 6 Autopilot (módulo 9)

Uso: node community-intel.js <comando> [opções]

Comandos:
  init        Inicializa o diretório de dados e registra o consentimento
              --consent-confirmed --consent-note "<quem autorizou, quando, termos>"
              [--group-label "<rótulo>"] [--retention-days 180] [--handoff-dir <dir>]
  import      Importa uma exportação do WhatsApp (.txt/.zip) ou JSON/JSONL normalizado
              <arquivo> [--format auto|whatsapp|whatsapp-zip|jsonl] [--date-order dmy|mdy] [--label "<rótulo>"]
  analyze     Gera ranking, tendências, pautas, handoffs e dashboard
              [--window-days 7] [--as-of AAAA-MM-DD] [--limit 5] [--handoff-dir <dir>]
  suggestions Lista pautas ou muda status
              list [--status <status>] | status <id> <nova|enviada|verificada|rejeitada|convertida|descartada> [--note "..."]
  video       Vincula um vídeo publicado a um tema/pauta
              link --video-id <id> --platform tiktok|youtube_shorts (--suggestion <id> | --topic <topicId>)
              [--title "..."] [--published-at AAAA-MM-DD]
  metrics     Importa métricas de vídeos (CSV/JSON exportado das plataformas)
              import <arquivo>
  opt-out     Remove e bloqueia um participante que pediu para não ser analisado
              --name "<nome exibido na exportação>"
  purge       Exclui dados importados (exige --yes)
              --import <id> | --older-than <dias> | --all
  imports     Lista importações armazenadas
  status      Mostra o estado do diretório de dados

Opções globais:
  --data-dir <dir>   Diretório de dados (padrão: $GTA6_COMMUNITY_DATA_DIR ou ./.gta6-autopilot/community-intelligence)
  --json             Saída em JSON
  --now <ISO>        Fixa o relógio (testes e reprocessamento determinístico)
`;

const BOOLEAN_FLAGS = new Set(['consent-confirmed', 'yes', 'all', 'json', 'help']);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      const key = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
      if (eq > 0) flags[key] = arg.slice(eq + 1);
      else if (BOOLEAN_FLAGS.has(key)) flags[key] = true;
      else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) throw new Error(`Opção --${key} exige um valor`);
        flags[key] = next;
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

function print(result, flags, text) {
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else console.log(text);
}

function common(flags) {
  return { dataDir: flags['data-dir'], now: flags.now };
}

function run(argv) {
  const { positional, flags } = parseArgs(argv);
  const [command, sub, ...rest] = positional;
  const base = common(flags);

  if (!command || command === 'help' || flags.help) {
    console.log(HELP);
    return 0;
  }

  switch (command) {
    case 'init': {
      const { store, config } = pipeline.init({
        ...base,
        consentConfirmed: Boolean(flags['consent-confirmed']),
        consentNote: flags['consent-note'],
        groupLabel: flags['group-label'],
        retentionDays: flags['retention-days'],
        handoffDir: flags['handoff-dir']
      });
      const { salt: _salt, ...safe } = config;
      print(safe, flags, [
        `Diretório: ${store.root}`,
        `Consentimento: ${config.consent.confirmed ? `registrado (${config.consent.note})` : 'NÃO registrado — importação bloqueada'}`,
        `Retenção: ${config.retentionDays} dias`
      ].join('\n'));
      return 0;
    }
    case 'import': {
      if (!sub) throw new Error('Informe o arquivo: import <arquivo>');
      const manifest = pipeline.importFile(sub, { ...base, format: flags.format, dateOrder: flags['date-order'], label: flags.label });
      print(manifest, flags, [
        `Importação ${manifest.id}`,
        `  Formato: ${manifest.format} · ordem de data: ${manifest.dateOrder}`,
        `  Participantes no arquivo: ${manifest.participants}`,
        `  Mensagens armazenadas: ${manifest.storedMessages}`,
        `  Ignoradas: ${manifest.parseStats.system} de sistema, ${manifest.parseStats.media} mídia, ${manifest.parseStats.deleted} apagadas, `
          + `${manifest.skipped.duplicates} duplicadas, ${manifest.skipped.optedOut} opt-out, ${manifest.skipped.expired} fora da retenção`,
        manifest.period ? `  Período: ${manifest.period.from} → ${manifest.period.to}` : '  Nenhuma mensagem nova.'
      ].join('\n'));
      return 0;
    }
    case 'analyze': {
      const result = pipeline.analyzeAndPublish({
        ...base,
        windowDays: flags['window-days'],
        asOf: flags['as-of'],
        limit: flags.limit,
        handoffDir: flags['handoff-dir']
      });
      const top = result.analysis.ranking.slice(0, 10).map((row, index) => `  ${String(index + 1).padStart(2)}. ${row.label.padEnd(44)} ${String(row.score).padStart(5)}  `
        + `(${row.current.messages} msgs, ${row.current.authors} part., ${row.confidence})`);
      print({
        asOf: result.analysis.asOf,
        window: result.analysis.window,
        ranking: result.analysis.ranking.map(row => ({ id: row.id, label: row.label, score: row.score, confidence: row.confidence })),
        emergingTrends: result.analysis.emergingTrends,
        opportunities: result.opportunities,
        createdSuggestions: result.created,
        handoffFiles: result.handoffFiles,
        dashboard: result.dashboard
      }, flags, [
        `Janela ${result.analysis.window.start} → ${result.analysis.window.end}: ${result.analysis.window.messages} mensagens, ${result.analysis.window.activeParticipants} participantes`,
        'Ranking:',
        ...(top.length ? top : ['  (nenhum tema)']),
        `Tendências emergentes: ${result.analysis.emergingTrends.join(', ') || 'nenhuma'}`,
        `Oportunidades pouco exploradas: ${result.opportunities.map(item => item.topicId).join(', ') || 'nenhuma'}`,
        `Novas pautas: ${result.created.length}`,
        ...result.created.map(item => `  - [${item.id}] ${item.title}`),
        `Handoffs: ${result.handoffFiles.length} arquivos`,
        `Dashboard: ${result.dashboard}`
      ].join('\n'));
      return 0;
    }
    case 'suggestions': {
      if (!sub || sub === 'list') {
        const list = pipeline.loadSuggestions(pipeline.createStore(base.dataDir))
          .filter(item => !flags.status || item.status === flags.status);
        print(list, flags, list.length
          ? list.map(item => `[${item.id}] ${item.status.padEnd(10)} ${item.createdAt} ${item.title}`).join('\n')
          : 'Nenhuma pauta.');
        return 0;
      }
      if (sub === 'status') {
        const [id, status] = rest;
        if (!id || !status) throw new Error('Uso: suggestions status <id> <status>');
        const updated = pipeline.setSuggestionStatus(id, status, { ...base, note: flags.note });
        print(updated, flags, `[${updated.id}] agora: ${updated.status}`);
        return 0;
      }
      throw new Error(`Subcomando desconhecido: suggestions ${sub}`);
    }
    case 'video': {
      if (sub !== 'link') throw new Error('Uso: video link --video-id <id> --platform <plataforma> (--suggestion <id> | --topic <id>)');
      const video = pipeline.linkVideo({
        videoId: flags['video-id'],
        platform: flags.platform,
        suggestionId: flags.suggestion,
        topicId: flags.topic,
        title: flags.title,
        publishedAt: flags['published-at']
      }, base);
      print(video, flags, `Vídeo ${video.platform}:${video.videoId} vinculado ao tema ${video.topicId}`);
      return 0;
    }
    case 'metrics': {
      if (sub !== 'import' || !rest[0]) throw new Error('Uso: metrics import <arquivo>');
      const result = pipeline.importMetrics(rest[0], base);
      print(result, flags, `Métricas atualizadas para ${result.updated} vídeo(s)`);
      return 0;
    }
    case 'opt-out': {
      const result = pipeline.optOut(flags.name, base);
      print(result, flags, `Participante bloqueado em importações futuras; ${result.removed} mensagem(ns) removida(s).`);
      return 0;
    }
    case 'purge': {
      const result = pipeline.purge({
        ...base,
        yes: Boolean(flags.yes),
        all: Boolean(flags.all),
        importId: flags.import,
        olderThanDays: flags['older-than']
      });
      const text = result.scope === 'all'
        ? `Todos os dados excluídos (${result.root}).`
        : result.scope === 'import'
          ? `Importação ${result.importId} excluída.`
          : `${result.removed} mensagem(ns) excluída(s).`;
      print(result, flags, text);
      return 0;
    }
    case 'imports': {
      const list = pipeline.createStore(base.dataDir).listImports();
      print(list, flags, list.length
        ? list.map(item => `${item.id}  ${item.importedAt.slice(0, 10)}  ${item.format.padEnd(12)} ${item.storedMessages} msgs  `
          + `${item.period ? `${item.period.from} → ${item.period.to}` : ''}${item.sourceLabel ? `  (${item.sourceLabel})` : ''}`).join('\n')
        : 'Nenhuma importação.');
      return 0;
    }
    case 'status': {
      const result = pipeline.status(base);
      print(result, flags, result.initialized
        ? [
          `Diretório: ${result.root}`,
          `Grupo: ${result.groupLabel}`,
          `Consentimento: ${result.consent.confirmed ? 'registrado' : 'NÃO registrado'}`,
          `Importações: ${result.imports} · mensagens: ${result.messages}${result.period ? ` (${result.period.from} → ${result.period.to})` : ''}`,
          `Retenção: ${result.retentionDays} dias · opt-outs: ${result.optOuts}`,
          `Pautas: ${JSON.stringify(result.suggestions)} · vídeos rastreados: ${result.videos}`
        ].join('\n')
        : `Não inicializado (${result.root}). Rode "init".`);
      return 0;
    }
    default:
      throw new Error(`Comando desconhecido: ${command}. Use "help".`);
  }
}

if (require.main === module) {
  try {
    process.exitCode = run(process.argv.slice(2));
  } catch (error) {
    console.error(`Erro: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { run, parseArgs };
