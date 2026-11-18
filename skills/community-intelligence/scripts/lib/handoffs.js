'use strict';

/**
 * Handoff payloads for the other GTA 6 Autopilot agents.
 *
 * Payloads contain aggregates and synthesized topic labels only: no message
 * text, no pseudonyms, no participant data. See
 * skills/community-intelligence/references/handoff-contracts.md.
 */

const SCHEMA_VERSION = 1;

const DISCLAIMER = 'Sinal complementar de uma comunidade de networking. Não é fonte de notícias nem confirma fatos. '
  + 'Volume de mensagens no grupo não representa popularidade geral.';

function envelope(consumer, analysis, generatedAt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    producer: 'community-intelligence',
    consumer,
    generatedAt,
    sourceType: 'complementary-community-signal',
    disclaimer: DISCLAIMER,
    privacy: { containsPersonalData: false, containsMessageText: false, trainingUse: 'prohibited' },
    window: { asOf: analysis.asOf, days: analysis.windowDays, ...analysis.window }
  };
}

function topicSummary(row) {
  return {
    topicId: row.id,
    label: row.label,
    emergent: row.emergent,
    risk: row.risk,
    score: row.score,
    confidence: row.confidence,
    components: row.components,
    dominantSignal: row.dominantSignal,
    growthRatio: row.growthRatio,
    current: {
      messages: row.current.messages,
      participants: row.current.authors,
      effectiveParticipants: row.current.effectiveAuthors,
      activeDays: row.current.activeDays,
      signals: row.current.signals
    },
    previous: { messages: row.previous.messages, participants: row.previous.authors },
    keywords: row.keywords
  };
}

function buildScoutHandoff({ analysis, suggestions, generatedAt }) {
  return {
    ...envelope('gta-scout', analysis, generatedAt),
    request: 'Verificar cada pauta contra fontes oficiais antes da produção e devolver status (verificada/rejeitada).',
    suggestions: suggestions.filter(item => item.status === 'nova' || item.status === 'enviada'),
    rumorWatch: analysis.ranking.filter(row => row.risk === 'rumor' && row.current.messages > 0).map(topicSummary),
    topTopics: analysis.ranking.slice(0, 10).map(topicSummary)
  };
}

function buildTrendHandoff({ analysis, opportunities, generatedAt }) {
  return {
    ...envelope('trend-analyst', analysis, generatedAt),
    request: 'Cruzar com sinais externos (busca, redes, notícias) antes de concluir que um tema está em alta.',
    ranking: analysis.ranking.map(topicSummary),
    emergingTrends: analysis.emergingTrends,
    opportunities,
    history: analysis.history
  };
}

function buildRecommendations(performance, opportunities) {
  const recommendations = [];
  for (const [platform, rows] of Object.entries(performance.leaderboard)) {
    const name = platform === 'tiktok' ? 'TikTok' : 'YouTube Shorts';
    const best = rows.find(row => row.videos >= 2 && row.performanceIndex >= 1.2);
    if (best) {
      recommendations.push(`Priorizar o tema "${best.topicId}" no ${name}: índice ${best.performanceIndex} em ${best.videos} vídeos.`);
    }
    const worst = rows.slice().reverse().find(row => row.videos >= 2 && row.performanceIndex <= 0.7);
    if (worst) {
      recommendations.push(`Rever formato do tema "${worst.topicId}" no ${name}: índice ${worst.performanceIndex}.`);
    }
  }
  const predictive = performance.scorePredictsPerformance;
  if (predictive.spearman !== null) {
    if (predictive.spearman >= 0.3) recommendations.push(`O score da comunidade tem correlação positiva com o desempenho (ρ=${predictive.spearman}); manter o peso desta fonte.`);
    else if (predictive.spearman <= 0) recommendations.push(`O score da comunidade não prevê desempenho (ρ=${predictive.spearman}); reduzir o peso desta fonte nas decisões.`);
  }
  for (const opportunity of opportunities.slice(0, 3)) {
    recommendations.push(`Oportunidade pouco explorada: "${opportunity.label}" — ${opportunity.reason}.`);
  }
  return recommendations;
}

function buildGrowthHandoff({ analysis, performance, opportunities, topicHistory, generatedAt }) {
  return {
    ...envelope('growth-manager', analysis, generatedAt),
    request: 'Usar o histórico tema → desempenho para calibrar prioridades de pauta por plataforma.',
    learning: {
      baselines: performance.baselines,
      performanceByTopic: performance.performanceByTopic,
      leaderboard: performance.leaderboard,
      communityVsOther: performance.communityVsOther,
      scorePredictsPerformance: performance.scorePredictsPerformance
    },
    topicHistory,
    recommendations: buildRecommendations(performance, opportunities)
  };
}

module.exports = {
  SCHEMA_VERSION,
  DISCLAIMER,
  topicSummary,
  buildScoutHandoff,
  buildTrendHandoff,
  buildGrowthHandoff
};
