'use strict';

/**
 * Static COMMUNITY INTELLIGENCE dashboard section (self-contained HTML) plus
 * data.json for embedding in a larger GTA 6 Autopilot dashboard.
 * Shows aggregates only: no message text, no participants.
 */

const SIGNAL_LABELS = {
  question: 'Dúvidas',
  curiosity: 'Curiosidades',
  disagreement: 'Debate',
  hype: 'Empolgação',
  discussion: 'Discussão'
};

const COMPONENT_LABELS = {
  frequency: 'Frequência',
  growth: 'Crescimento',
  diversity: 'Diversidade',
  debate: 'Debate',
  potential: 'Potencial',
  relevance: 'Relevância'
};

const STATUS_LABELS = {
  nova: 'Nova', enviada: 'Enviada', verificada: 'Verificada', rejeitada: 'Rejeitada', convertida: 'Convertida', descartada: 'Descartada'
};

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return Number(value).toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtChange(previous, current) {
  const arrow = current > previous ? '▲' : current < previous ? '▼' : '=';
  return `${fmtNumber(previous)} → ${fmtNumber(current)} ${arrow}`;
}

function sparkline(values, width = 120, height = 28) {
  if (!values || values.length === 0) return '';
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const points = values.map((value, index) => `${(index * step).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`);
  const last = points[points.length - 1].split(',');
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Série semanal: ${esc(values.join(', '))}">`
    + `<polyline fill="none" stroke="currentColor" stroke-width="1.5" points="${points.join(' ')}"/>`
    + `<circle cx="${last[0]}" cy="${last[1]}" r="2.5" fill="currentColor"/></svg>`;
}

function bar(value, label) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return `<span class="bar" title="${esc(label)}: ${pct}"><span style="width:${pct}%"></span></span>`;
}

function badges(row) {
  const out = [];
  if (row.emergent) out.push('<span class="badge emergent">emergente</span>');
  if (row.risk === 'rumor') out.push('<span class="badge rumor">rumor</span>');
  out.push(`<span class="badge conf-${esc(row.confidence)}">confiança ${esc(row.confidence)}</span>`);
  return out.join(' ');
}

function rankingSection(ranking) {
  if (ranking.length === 0) return '<p class="empty">Nenhum tema detectado na janela atual.</p>';
  const rows = ranking.filter(row => row.current.messages > 0).slice(0, 15).map((row, index) => `
      <tr>
        <td class="num">${index + 1}</td>
        <td><strong>${esc(row.label)}</strong><div class="meta">${badges(row)} · ${esc(SIGNAL_LABELS[row.dominantSignal] || row.dominantSignal)}</div></td>
        <td class="score"><span class="score-val">${fmtNumber(row.score, 0)}</span>${bar(row.score / 100, 'Score')}</td>
        <td class="components">${Object.entries(COMPONENT_LABELS).map(([key, label]) => `<div><span>${label}</span>${bar(row.components[key], label)}</div>`).join('')}</td>
        <td class="num">${fmtNumber(row.current.messages)}</td>
        <td class="num">${fmtNumber(row.current.authors)} <span class="meta">(${fmtNumber(row.current.effectiveAuthors, 1)} ef.)</span></td>
        <td class="num ${row.growthRatio > 0 ? 'up' : row.growthRatio < 0 ? 'down' : ''}">${fmtChange(row.previous.messages, row.current.messages)}</td>
      </tr>`).join('');
  return `
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Tema</th><th>Score</th><th class="c-comp">Composição</th><th>Msgs</th><th>Participantes</th><th>Msgs: antes → agora</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="note">Participantes efetivos descontam concentração: 20 mensagens de 1 pessoa não valem o mesmo que 20 mensagens de 10 pessoas.</p>`;
}

function trendsSection(analysis) {
  const byId = new Map(analysis.ranking.map(row => [row.id, row]));
  const trends = analysis.emergingTrends.map(id => byId.get(id)).filter(Boolean);
  if (trends.length === 0) return '<p class="empty">Nenhuma tendência emergente com amostra suficiente nesta janela.</p>';
  return `<div class="cards">${trends.map(row => `
      <article class="card">
        <h3>${esc(row.label)}</h3>
        <div class="meta">${badges(row)}</div>
        <p class="big up">${fmtChange(row.previous.messages, row.current.messages)}</p>
        <p class="meta">mensagens na janela anterior → atual · ${fmtNumber(row.current.authors)} participantes agora (antes: ${fmtNumber(row.previous.authors)})</p>
        ${sparkline(analysis.history.series[row.id])}
      </article>`).join('')}</div>`;
}

function suggestionsSection(suggestions) {
  const open = suggestions.filter(item => ['nova', 'enviada', 'verificada'].includes(item.status))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.communityScore - a.communityScore);
  if (open.length === 0) return '<p class="empty">Nenhuma pauta aberta.</p>';
  return `<div class="cards">${open.slice(0, 12).map(item => `
      <article class="card">
        <div class="meta"><span class="badge status-${esc(item.status)}">${esc(STATUS_LABELS[item.status] || item.status)}</span>
          ${item.risk === 'rumor' ? '<span class="badge rumor">rumor</span>' : ''} · ${esc(item.createdAt)} · <code>${esc(item.id)}</code></div>
        <h3>${esc(item.title)}</h3>
        <p><em>Gancho:</em> ${esc(item.hook)}</p>
        <p class="meta">${esc(item.format)} · ${esc(item.platforms.map(p => (p === 'tiktok' ? 'TikTok' : 'YouTube Shorts')).join(' + '))}</p>
        <p class="meta">${esc(item.reason)} · score ${fmtNumber(item.communityScore, 0)} · ${fmtNumber(item.evidence.participants)} participantes</p>
        <p class="factcheck">⚠ ${esc(item.factCheck.reason)}</p>
      </article>`).join('')}</div>`;
}

function historySection(analysis, topicHistory) {
  const ids = analysis.ranking.slice(0, 12).map(row => row.id);
  if (ids.length === 0) return '<p class="empty">Sem histórico ainda.</p>';
  const byId = new Map(analysis.ranking.map(row => [row.id, row]));
  const rows = ids.map(id => {
    const scores = topicHistory.map(snapshot => {
      const found = snapshot.topics.find(topic => topic.topicId === id);
      return found ? found.score : 0;
    });
    return `<tr>
        <td>${esc(byId.get(id).label)}</td>
        <td>${sparkline(analysis.history.series[id])}</td>
        <td class="num">${esc(analysis.history.series[id].join(' · '))}</td>
        <td>${scores.length > 1 ? sparkline(scores) : '<span class="meta">1 análise</span>'}</td>
      </tr>`;
  }).join('');
  return `<div class="table-wrap"><table>
      <thead><tr><th>Tema</th><th>Volume semanal (8 sem.)</th><th>Série</th><th>Score por análise</th></tr></thead>
      <tbody>${rows}</tbody></table></div>
    <p class="note">Semanas terminando em: ${esc(analysis.history.weeks.join(', '))}.</p>`;
}

function convertedSection(suggestions, performance) {
  const videosBySuggestion = new Map();
  for (const video of performance.videos) {
    if (!video.suggestionId) continue;
    const list = videosBySuggestion.get(video.suggestionId) || [];
    list.push(video);
    videosBySuggestion.set(video.suggestionId, list);
  }
  const converted = suggestions.filter(item => item.status === 'convertida' || videosBySuggestion.has(item.id));
  const total = suggestions.length;
  const rate = total ? Math.round((converted.length / total) * 100) : 0;
  if (converted.length === 0) {
    return `<p class="empty">Nenhuma pauta convertida em vídeo ainda (${fmtNumber(total)} sugeridas).</p>`;
  }
  const rows = converted.map(item => {
    const videos = videosBySuggestion.get(item.id) || [];
    return `<tr><td>${esc(item.title)}</td><td>${esc(item.topicLabel)}</td>
      <td>${videos.map(video => `${esc(video.platform === 'tiktok' ? 'TikTok' : 'Shorts')}: ${esc(video.title || video.videoId)}`).join('<br>') || '—'}</td>
      <td class="num">${videos.map(video => fmtNumber(video.metrics && video.metrics.views)).join('<br>') || '—'}</td></tr>`;
  }).join('');
  return `<p class="kpi"><strong>${fmtNumber(converted.length)}</strong> de ${fmtNumber(total)} pautas viraram vídeo (${rate}%).</p>
    <div class="table-wrap"><table><thead><tr><th>Pauta</th><th>Tema</th><th>Vídeos</th><th>Views</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function performanceSection(performance) {
  const community = performance.videos.filter(video => video.origin === 'community');
  if (community.length === 0) {
    return '<p class="empty">Nenhum vídeo vinculado a temas da comunidade. Use <code>video link</code> e <code>metrics import</code>.</p>';
  }
  const cvo = performance.communityVsOther;
  const kpis = `<div class="kpis">
      <div><span class="meta">Vídeos da comunidade</span><strong>${fmtNumber(cvo.community.videos)}</strong></div>
      <div><span class="meta">Índice mediano (comunidade)</span><strong>${fmtNumber(cvo.community.medianIndex, 2)}</strong></div>
      <div><span class="meta">Índice mediano (outros)</span><strong>${fmtNumber(cvo.other.medianIndex, 2)}</strong></div>
      <div><span class="meta">Score prevê desempenho? (ρ)</span><strong>${performance.scorePredictsPerformance.spearman === null ? '—' : fmtNumber(performance.scorePredictsPerformance.spearman, 2)}</strong></div>
    </div>`;
  const boards = Object.entries(performance.leaderboard).map(([platform, rows]) => `
      <div class="board"><h3>${platform === 'tiktok' ? 'TikTok' : 'YouTube Shorts'}</h3>
      ${rows.length === 0 ? '<p class="empty">Sem dados.</p>' : `<ol>${rows.slice(0, 8).map(row => `<li><span>${esc(row.topicId)}</span> <strong>${fmtNumber(row.performanceIndex, 2)}</strong> <span class="meta">(${row.videos} vídeo${row.videos > 1 ? 's' : ''}, mediana ${fmtNumber(row.medianViews)} views)</span></li>`).join('')}</ol>`}
      </div>`).join('');
  const rows = community.slice().sort((a, b) => (b.performanceIndex || 0) - (a.performanceIndex || 0)).slice(0, 20).map(video => `
      <tr><td>${esc(video.title || video.videoId)}</td><td>${video.platform === 'tiktok' ? 'TikTok' : 'Shorts'}</td><td>${esc(video.topicId)}</td>
      <td class="num">${fmtNumber(video.metrics && video.metrics.views)}</td>
      <td class="num">${video.engagementRate === null ? '—' : `${fmtNumber(video.engagementRate * 100, 1)}%`}</td>
      <td class="num">${video.metrics && video.metrics.avgWatchPct !== undefined && video.metrics.avgWatchPct !== null ? `${fmtNumber(video.metrics.avgWatchPct, 0)}%` : '—'}</td>
      <td class="num ${video.performanceIndex >= 1 ? 'up' : 'down'}">${fmtNumber(video.performanceIndex, 2)}</td></tr>`).join('');
  return `${kpis}<div class="boards">${boards}</div>
    <div class="table-wrap"><table><thead><tr><th>Vídeo</th><th>Plataforma</th><th>Tema</th><th>Views</th><th>Engajamento</th><th>Retenção</th><th>Índice</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="note">Índice = média geométrica de (views ÷ mediana da plataforma) e (engajamento ÷ mediana). 1,0 = desempenho típico do canal.</p>`;
}

function opportunitiesSection(opportunities) {
  if (opportunities.length === 0) return '<p class="empty">Nenhuma oportunidade descoberta nesta janela.</p>';
  return `<ul class="opps">${opportunities.map(item => `<li><strong>${esc(item.label)}</strong> <span class="meta">score ${fmtNumber(item.score, 0)}</span><br>${esc(item.reason)}</li>`).join('')}</ul>`;
}

function privacySection(imports, config) {
  const rows = imports.map(item => `<tr><td><code>${esc(item.id)}</code></td><td>${esc(item.importedAt.slice(0, 10))}</td><td>${esc(item.format)}</td>
      <td>${esc(item.period ? `${item.period.from} → ${item.period.to}` : '—')}</td><td class="num">${fmtNumber(item.storedMessages)}</td></tr>`).join('');
  return `<p>Dados armazenados: mensagens com autor pseudonimizado e texto sem telefones, e-mails, menções, links de perfil e nomes de participantes.
      Retenção: ${fmtNumber(config.retentionDays)} dias. Opt-outs ativos: ${fmtNumber((config.optOut || []).length)}. Uso para treinamento: proibido.</p>
    ${imports.length ? `<div class="table-wrap"><table><thead><tr><th>Importação</th><th>Data</th><th>Formato</th><th>Período</th><th>Mensagens</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="empty">Nenhuma importação armazenada.</p>'}
    <p class="note">Excluir: <code>purge --import &lt;id&gt; --yes</code> · <code>purge --all --yes</code> · <code>opt-out --name "..."</code></p>`;
}

const STYLE = `
:root{--bg:#f7f7f5;--surface:#fff;--text:#1b1b1f;--muted:#62626b;--border:#e3e3e0;--accent:#c2185b;--accent-soft:#fce4ec;--up:#1b7f4b;--down:#b3261e;--warn:#8a5a00;--warn-bg:#fff4d6;--bar:#e9e9e6}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121215;--surface:#1b1b20;--text:#ececf0;--muted:#a0a0ab;--border:#2c2c33;--accent:#ff6fa5;--accent-soft:#3a1626;--up:#58c48b;--down:#ff8a80;--warn:#ffcf66;--warn-bg:#2f2610;--bar:#2c2c33}}
:root[data-theme="dark"]{--bg:#121215;--surface:#1b1b20;--text:#ececf0;--muted:#a0a0ab;--border:#2c2c33;--accent:#ff6fa5;--accent-soft:#3a1626;--up:#58c48b;--down:#ff8a80;--warn:#ffcf66;--warn-bg:#2f2610;--bar:#2c2c33}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:1180px;margin:0 auto;padding:24px 16px 64px}
header h1{margin:0;font-size:1.6rem;letter-spacing:.06em}header .sub{color:var(--muted)}
.disclaimer{background:var(--warn-bg);color:var(--warn);border-radius:10px;padding:10px 14px;margin:16px 0}
section{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px;margin-top:18px}
section h2{margin:0 0 12px;font-size:1.1rem}
.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px;border-bottom:1px solid var(--border);vertical-align:top}
th{font-size:.8rem;color:var(--muted);font-weight:600}.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.meta,.note{color:var(--muted);font-size:.85rem}.note{margin-top:10px}.empty{color:var(--muted)}
.bar{display:inline-block;width:70px;height:6px;background:var(--bar);border-radius:3px;vertical-align:middle;margin-left:6px}.bar span{display:block;height:100%;background:var(--accent);border-radius:3px}
.components div{display:flex;justify-content:space-between;align-items:center;font-size:.75rem;color:var(--muted);gap:6px}
.score-val{font-weight:700;font-size:1.1rem;font-variant-numeric:tabular-nums}
.badge{display:inline-block;font-size:.72rem;padding:1px 7px;border-radius:999px;background:var(--bar);color:var(--text)}
.badge.emergent{background:var(--accent-soft);color:var(--accent)}.badge.rumor{background:var(--warn-bg);color:var(--warn)}
.badge.conf-baixa{opacity:.7}.up{color:var(--up)}.down{color:var(--down)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px}.card{border:1px solid var(--border);border-radius:12px;padding:14px}
.card h3{margin:6px 0;font-size:1rem}.big{font-size:1.6rem;font-weight:700;margin:4px 0}.factcheck{color:var(--warn);font-size:.82rem}
.spark{color:var(--accent);display:block}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:12px}
.kpis div{border:1px solid var(--border);border-radius:10px;padding:10px}.kpis strong{display:block;font-size:1.4rem;font-variant-numeric:tabular-nums}
.boards{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:12px}.board h3{margin:0 0 6px;font-size:.95rem}
.opps li{margin-bottom:8px}@media (max-width:640px){.c-comp,td.components{display:none}}code{font-size:.8em}.kpi{font-size:1rem}
`;

function renderDashboard(data) {
  const { analysis, suggestions, performance, opportunities, topicHistory, imports, config, generatedAt } = data;
  const w = analysis.window;
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Community Intelligence</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <header>
    <h1>COMMUNITY INTELLIGENCE</h1>
    <div class="sub">GTA 6 Autopilot · janela ${esc(w.start)} → ${esc(w.end)} (${esc(analysis.windowDays)} dias) · ${fmtNumber(w.messages)} mensagens · ${fmtNumber(w.activeParticipants)} participantes ativos · gerado em ${esc(generatedAt.slice(0, 16).replace('T', ' '))}</div>
  </header>
  <p class="disclaimer">Fonte complementar: discussões de um grupo de networking. Não confirma fatos nem representa popularidade geral. Toda pauta passa pelo GTA Scout antes da produção.</p>
  <section id="temas"><h2>Temas mais discutidos</h2>${rankingSection(analysis.ranking)}</section>
  <section id="tendencias"><h2>Tendências emergentes</h2>${trendsSection(analysis)}</section>
  <section id="pautas"><h2>Novas pautas sugeridas</h2>${suggestionsSection(suggestions)}</section>
  <section id="oportunidades"><h2>Oportunidades pouco exploradas</h2>${opportunitiesSection(opportunities)}</section>
  <section id="historico"><h2>Histórico de assuntos</h2>${historySection(analysis, topicHistory)}</section>
  <section id="convertidas"><h2>Pautas convertidas em vídeos</h2>${convertedSection(suggestions, performance)}</section>
  <section id="desempenho"><h2>Desempenho dos vídeos originados das discussões</h2>${performanceSection(performance)}</section>
  <section id="privacidade"><h2>Privacidade e dados importados</h2>${privacySection(imports, config)}</section>
</main>
</body>
</html>
`;
}

function dashboardData(data) {
  const { analysis, suggestions, performance, opportunities, topicHistory, imports, config, generatedAt } = data;
  return {
    section: 'COMMUNITY INTELLIGENCE',
    generatedAt,
    trainingUse: 'prohibited',
    window: { asOf: analysis.asOf, days: analysis.windowDays, ...analysis.window },
    topTopics: analysis.ranking.slice(0, 15).map(row => ({
      topicId: row.id, label: row.label, score: row.score, confidence: row.confidence, emergent: row.emergent,
      risk: row.risk, components: row.components, messages: row.current.messages, participants: row.current.authors,
      effectiveParticipants: row.current.effectiveAuthors, growthRatio: row.growthRatio, dominantSignal: row.dominantSignal
    })),
    emergingTrends: analysis.emergingTrends,
    suggestions: suggestions.filter(item => ['nova', 'enviada', 'verificada'].includes(item.status)),
    convertedSuggestions: suggestions.filter(item => item.status === 'convertida').map(item => item.id),
    opportunities,
    history: { weekly: analysis.history, scoresByRun: topicHistory },
    performance: {
      communityVsOther: performance.communityVsOther,
      leaderboard: performance.leaderboard,
      scorePredictsPerformance: performance.scorePredictsPerformance,
      videos: performance.videos.filter(video => video.origin === 'community').map(video => ({
        videoId: video.videoId, platform: video.platform, topicId: video.topicId, suggestionId: video.suggestionId,
        title: video.title, publishedAt: video.publishedAt, metrics: video.metrics,
        engagementRate: video.engagementRate, performanceIndex: video.performanceIndex
      }))
    },
    data: { imports: imports.length, retentionDays: config.retentionDays, optOuts: (config.optOut || []).length }
  };
}

module.exports = { renderDashboard, dashboardData, esc, sparkline };
