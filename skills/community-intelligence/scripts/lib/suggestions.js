'use strict';

/**
 * Turn ranked discussions into video suggestions and find underexplored
 * opportunities.
 *
 * Suggestions are drafts: the community is a complementary signal, never a
 * source of facts. Every suggestion is routed to GTA Scout for verification
 * against official sources before production.
 */

const crypto = require('crypto');

const STATUSES = ['nova', 'enviada', 'verificada', 'rejeitada', 'convertida', 'descartada'];
const OPEN_STATUSES = new Set(['nova', 'enviada', 'verificada']);
const DEFAULT_PLATFORMS = ['tiktok', 'youtube_shorts'];
const DAY_MS = 24 * 60 * 60 * 1000;

const TEMPLATES = {
  question: {
    title: label => `${label}: a dúvida nº1 da comunidade, respondida`,
    hook: label => `Muita gente está perguntando sobre ${label.toLowerCase()}. Isso é o que já é oficial.`,
    format: 'Pergunta → resposta com fonte oficial na tela (20–35s)'
  },
  curiosity: {
    title: label => `${label}: detalhes que quase ninguém percebeu`,
    hook: () => 'Você reparou nisso?',
    format: 'Lista de 3 detalhes com zoom em material oficial (25–40s)'
  },
  disagreement: {
    title: label => `${label}: o debate que está dividindo os fãs`,
    hook: () => 'Metade acha uma coisa, metade acha outra. Quem tem razão?',
    format: 'Os dois lados + pergunta para os comentários (30–45s)'
  },
  hype: {
    title: label => `${label}: por que todo mundo está falando disso`,
    hook: () => 'Isso explodiu nos últimos dias. Em 30 segundos você entende.',
    format: 'Recap rápido + reação (15–30s)'
  },
  discussion: {
    title: label => `${label}: o que a comunidade quer saber`,
    hook: label => `O assunto do momento: ${label.toLowerCase()}.`,
    format: 'Explicador direto (20–35s)'
  },
  emergent: {
    title: (_label, term) => `O que está por trás de "${term}" no GTA 6?`,
    hook: () => 'Esse termo apareceu do nada nas conversas. De onde ele veio?',
    format: 'Explicador rápido após verificar a origem (20–30s)'
  }
};

function isoWeek(dateStr) {
  const date = new Date(`${dateStr}T00:00:00Z`);
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((date - firstThursday) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function suggestionId(topicId, angle, week) {
  return `sug-${crypto.createHash('sha256').update(`${topicId}|${angle}|${week}`).digest('hex').slice(0, 10)}`;
}

function shortLabel(label) {
  return label.replace(/^Emergente:\s*/, '').replace(/"/g, '');
}

function buildSuggestion(row, asOf, reason) {
  const angle = row.emergent ? 'emergent' : row.dominantSignal;
  const template = TEMPLATES[angle] || TEMPLATES.discussion;
  const label = shortLabel(row.label);
  const term = row.emergent ? row.keywords[0] : null;
  const rumor = row.risk === 'rumor';
  const title = rumor ? `Rumor ou fato? ${template.title(label, term)}` : template.title(label, term);
  const hook = rumor ? `Ainda não é oficial. ${template.hook(label, term)}` : template.hook(label, term);

  return {
    id: suggestionId(row.id, angle, isoWeek(asOf)),
    createdAt: asOf,
    topicId: row.id,
    topicLabel: row.label,
    angle,
    title,
    hook,
    format: template.format,
    platforms: DEFAULT_PLATFORMS.slice(),
    reason,
    communityScore: row.score,
    confidence: row.confidence,
    evidence: {
      messages: row.current.messages,
      participants: row.current.authors,
      effectiveParticipants: row.current.effectiveAuthors,
      growthRatio: row.growthRatio,
      dominantSignal: row.dominantSignal
    },
    risk: rumor ? 'rumor' : (row.emergent ? 'nao-verificado' : 'normal'),
    factCheck: {
      required: true,
      reason: rumor
        ? 'Tema de rumor/vazamento: não afirmar como fato; confirmar ou desmentir com fonte oficial.'
        : 'Discussão de comunidade não confirma fatos; validar com fontes oficiais (Rockstar Newswire, Take-Two IR) antes de publicar.'
    },
    routedTo: ['gta-scout', 'trend-analyst'],
    status: 'nova',
    statusHistory: [{ status: 'nova', at: asOf }]
  };
}

function videosForTopic(videos, topicId, sinceMs) {
  return videos.filter(video => video.origin === 'community' && video.topicId === topicId
    && (!video.publishedAt || Date.parse(video.publishedAt) >= sinceMs));
}

/**
 * Topics the community cares about that the channel has not covered (or has
 * covered with good results but rarely).
 */
function findOpportunities(ranking, videos, performanceByTopic, asOf) {
  const asOfMs = Date.parse(`${asOf}T23:59:59Z`);
  const since = asOfMs - 30 * DAY_MS;
  const eligible = ranking.filter(row => row.confidence !== 'baixa' || row.emergent);
  const scores = eligible.map(row => row.score).sort((a, b) => b - a);
  const threshold = scores.length ? scores[Math.min(scores.length - 1, Math.floor(scores.length / 2))] : 0;

  const opportunities = [];
  for (const row of eligible) {
    if (row.score < threshold) continue;
    const recent = videosForTopic(videos, row.id, since).length;
    const learned = performanceByTopic[row.id];
    if (recent === 0) {
      opportunities.push({
        topicId: row.id,
        label: row.label,
        score: row.score,
        reason: learned && learned.performanceIndex >= 1.2
          ? 'Alto interesse e bom histórico de desempenho, sem vídeo nos últimos 30 dias'
          : 'Alto interesse na comunidade e nenhum vídeo publicado nos últimos 30 dias',
        recentVideos: 0,
        performanceIndex: learned ? learned.performanceIndex : null
      });
    } else if (learned && learned.performanceIndex >= 1.2 && recent <= 1) {
      opportunities.push({
        topicId: row.id,
        label: row.label,
        score: row.score,
        reason: 'Desempenho acima da média e pouca cobertura recente',
        recentVideos: recent,
        performanceIndex: learned.performanceIndex
      });
    }
  }
  return opportunities;
}

/**
 * Merge new suggestions into the stored list without duplicating open ones.
 */
function generateSuggestions({ ranking, emergingTrends, opportunities, existing, asOf, limit = 5 }) {
  const existingList = existing || [];
  const byId = new Map(existingList.map(item => [item.id, item]));
  const openByTopic = new Set(existingList.filter(item => OPEN_STATUSES.has(item.status)
    && Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${item.createdAt}T00:00:00Z`) <= 14 * DAY_MS)
    .map(item => item.topicId));

  const picks = [];
  const pushPick = (row, reason) => {
    if (!row || picks.some(pick => pick.row.id === row.id)) return;
    picks.push({ row, reason });
  };

  const rankById = new Map(ranking.map(row => [row.id, row]));
  for (const id of emergingTrends) pushPick(rankById.get(id), 'Tendência emergente');
  for (const opportunity of opportunities) pushPick(rankById.get(opportunity.topicId), opportunity.reason);
  for (const row of ranking.filter(item => item.confidence !== 'baixa')) pushPick(row, 'Entre os temas mais relevantes da semana');

  const created = [];
  for (const { row, reason } of picks) {
    if (created.length >= limit) break;
    if (openByTopic.has(row.id)) continue;
    const suggestion = buildSuggestion(row, asOf, reason);
    if (byId.has(suggestion.id)) continue;
    byId.set(suggestion.id, suggestion);
    created.push(suggestion);
  }
  return { all: Array.from(byId.values()), created };
}

function updateSuggestionStatus(list, id, status, at, note) {
  if (!STATUSES.includes(status)) {
    throw new Error(`Status inválido: ${status} (use ${STATUSES.join(', ')})`);
  }
  let found = false;
  const updated = list.map(item => {
    if (item.id !== id) return item;
    found = true;
    const entry = note ? { status, at, note } : { status, at };
    return { ...item, status, statusHistory: [...(item.statusHistory || []), entry] };
  });
  if (!found) throw new Error(`Sugestão não encontrada: ${id}`);
  return updated;
}

module.exports = {
  STATUSES,
  isoWeek,
  buildSuggestion,
  findOpportunities,
  generateSuggestions,
  updateSuggestionStatus
};
