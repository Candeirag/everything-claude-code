'use strict';

/**
 * Topic detection, clustering and ranking.
 *
 * Messages are grouped into topics two ways:
 *  - taxonomy topics (GTA 6 keyword clusters, multi-label);
 *  - emergent topics: terms that are new or fast-growing in the current window,
 *    used by several distinct participants, and not covered by the taxonomy.
 *
 * Short replies with no keywords inherit the topic of the conversation they
 * answer (same thread within CONTEXT_GAP_MINUTES) at half weight, so debates
 * are not lost just because "concordo" carries no keyword.
 *
 * The ranking deliberately does not equate message volume with popularity:
 * frequency is one of six components, author concentration is penalized, and
 * every topic carries a confidence label based on sample size.
 */

const { normalize, contentTokens, bigrams } = require('./text');
const { mentionsGta, taxonomyKeywordSet, clamp01 } = require('./taxonomy');
const { computeSignals } = require('./signals');

const DAY_MS = 24 * 60 * 60 * 1000;
const CONTEXT_GAP_MINUTES = 10;
const CONTEXT_MAX_WORDS = 25;
const ALTERNATION_GAP_MINUTES = 30;

const DEFAULT_WEIGHTS = Object.freeze({
  frequency: 0.15,
  growth: 0.2,
  diversity: 0.2,
  debate: 0.1,
  potential: 0.2,
  relevance: 0.15
});

const EMERGENT_LIMITS = Object.freeze({ minMessages: 4, minAuthors: 3, minGrowthFactor: 2, maxTopics: 5 });

function toMs(ts) {
  return Date.parse(`${ts}Z`);
}

function dayOf(ts) {
  return ts.slice(0, 10);
}

function resolveAsOf(messages, asOf) {
  if (asOf) {
    const parsed = Date.parse(/T/.test(asOf) ? `${asOf}Z` : `${asOf}T23:59:59Z`);
    if (Number.isNaN(parsed)) throw new Error(`Data inválida em --as-of: ${asOf}`);
    return parsed;
  }
  if (messages.length === 0) return Date.now();
  const last = messages[messages.length - 1].ts;
  return Date.parse(`${dayOf(last)}T23:59:59Z`);
}

/** Label every message with taxonomy topics and signals. */
function labelMessages(messages, taxonomy) {
  const labeled = [];
  let previous = null;

  for (const message of messages) {
    const normalized = normalize(message.text);
    const signals = computeSignals(message.text);
    const topics = new Map();

    for (const topic of taxonomy) {
      if (!topic.regex) continue;
      topic.regex.lastIndex = 0;
      if (topic.regex.test(normalized)) topics.set(topic.id, 1);
    }

    let inherited = false;
    if (topics.size === 0 && previous && previous.topics.size > 0) {
      const gapMinutes = (toMs(message.ts) - toMs(previous.ts)) / 60000;
      if (gapMinutes <= CONTEXT_GAP_MINUTES && signals.words <= CONTEXT_MAX_WORDS) {
        for (const topicId of previous.topics.keys()) topics.set(topicId, 0.5);
        inherited = true;
      }
    }

    const entry = {
      ...message,
      ms: toMs(message.ts),
      normalized,
      signals,
      gta: mentionsGta(normalized),
      topics,
      inherited
    };
    labeled.push(entry);
    if (topics.size > 0) previous = entry;
  }
  return labeled;
}

function windowOf(labeled, startMs, endMs) {
  return labeled.filter(message => message.ms > startMs && message.ms <= endMs);
}

function termsOf(message, excluded) {
  const tokens = contentTokens(message.text).filter(token => !excluded.has(token));
  const unique = new Set(tokens);
  for (const pair of bigrams(contentTokens(message.text))) {
    const [left, right] = pair.split(' ');
    if (!excluded.has(left) || !excluded.has(right)) unique.add(pair);
  }
  return unique;
}

function countTerms(messages, excluded) {
  const counts = new Map();
  for (const message of messages) {
    for (const term of termsOf(message, excluded)) {
      const entry = counts.get(term) || { messages: 0, authors: new Set() };
      entry.messages++;
      entry.authors.add(message.author);
      counts.set(term, entry);
    }
  }
  return counts;
}

/**
 * Detect emergent terms and attach them as pseudo-topics to the labeled
 * messages (mutates the topics map of matching messages in place).
 */
function detectEmergentTopics(labeled, current, previous, taxonomy, limits = EMERGENT_LIMITS) {
  const excluded = taxonomyKeywordSet(taxonomy);
  const currentCounts = countTerms(current, excluded);
  const previousCounts = countTerms(previous, excluded);

  const candidates = [];
  for (const [term, entry] of currentCounts) {
    const before = previousCounts.has(term) ? previousCounts.get(term).messages : 0;
    if (entry.messages < limits.minMessages || entry.authors.size < limits.minAuthors) continue;
    if (entry.messages < limits.minGrowthFactor * (before + 1)) continue;
    candidates.push({ term, messages: entry.messages, authors: entry.authors.size, before });
  }

  // Prefer a bigram over its parts when the bigram carries most of the usage.
  const chosen = [];
  candidates.sort((a, b) => (b.authors * b.messages) - (a.authors * a.messages) || b.term.split(' ').length - a.term.split(' ').length);
  for (const candidate of candidates) {
    const overlaps = chosen.some(other => other.term.split(' ').some(part => candidate.term.split(' ').includes(part)));
    if (overlaps) continue;
    const parent = candidates.find(other => other.term !== candidate.term && other.term.split(' ').includes(candidate.term)
      && other.messages >= 0.6 * candidate.messages);
    if (parent && !chosen.includes(parent)) {
      chosen.push(parent);
    } else {
      chosen.push(candidate);
    }
    if (chosen.length >= limits.maxTopics) break;
  }

  const emergentTopics = chosen.map(candidate => ({
    id: `emergente:${candidate.term.replace(/\s+/g, '-')}`,
    label: `Emergente: "${candidate.term}"`,
    keywords: [candidate.term],
    term: candidate.term,
    emergent: true,
    relevance: null,
    visualPotential: 0.5,
    risk: 'normal'
  }));

  for (const topic of emergentTopics) {
    for (const message of labeled) {
      if (termsOf(message, excluded).has(topic.term)) message.topics.set(topic.id, 1);
    }
  }
  return emergentTopics;
}

function herfindahl(counts, total) {
  if (total <= 0) return 1;
  let sum = 0;
  for (const value of counts.values()) {
    const share = value / total;
    sum += share * share;
  }
  return sum;
}

function aggregateTopic(topicId, messages) {
  const inTopic = messages.filter(message => message.topics.has(topicId));
  const authorWeights = new Map();
  let weighted = 0;
  const totals = { question: 0, curiosity: 0, disagreement: 0, agreement: 0, hype: 0, gta: 0 };
  const days = new Set();

  for (const message of inTopic) {
    const weight = message.topics.get(topicId);
    weighted += weight;
    authorWeights.set(message.author, (authorWeights.get(message.author) || 0) + weight);
    for (const key of ['question', 'curiosity', 'disagreement', 'agreement', 'hype']) {
      if (message.signals[key]) totals[key] += weight;
    }
    if (message.gta) totals.gta += weight;
    days.add(dayOf(message.ts));
  }

  let alternations = 0;
  for (let i = 1; i < inTopic.length; i++) {
    const gap = (inTopic[i].ms - inTopic[i - 1].ms) / 60000;
    if (inTopic[i].author !== inTopic[i - 1].author && gap <= ALTERNATION_GAP_MINUTES) alternations++;
  }

  const hhi = herfindahl(authorWeights, weighted);
  const topShare = weighted > 0 ? Math.max(...authorWeights.values()) / weighted : 0;
  return {
    messages: inTopic.length,
    weighted: round(weighted, 2),
    authors: authorWeights.size,
    effectiveAuthors: round(weighted > 0 ? 1 / hhi : 0, 2),
    topAuthorShare: round(topShare, 3),
    activeDays: days.size,
    alternations,
    signals: Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, round(value, 2)]))
  };
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function confidenceOf(aggregate) {
  if (aggregate.authors >= 8 && aggregate.messages >= 25) return 'alta';
  if (aggregate.authors >= 4 && aggregate.messages >= 10) return 'media';
  return 'baixa';
}

function scoreTopics(topics, current, previous, context) {
  const { activeAuthors, performanceByTopic = {}, weights = DEFAULT_WEIGHTS } = context;
  const rows = topics.map(topic => ({
    topic,
    current: aggregateTopic(topic.id, current),
    previous: aggregateTopic(topic.id, previous)
  })).filter(row => row.current.messages > 0 || row.previous.messages > 0);

  const maxWeighted = Math.max(1, ...rows.map(row => row.current.weighted));
  const diversityTarget = Math.max(3, Math.min(10, activeAuthors * 0.5));

  return rows.map(({ topic, current: cur, previous: prev }) => {
    const n = Math.max(cur.weighted, 1e-9);
    const frequency = cur.weighted > 0 ? Math.log1p(cur.weighted) / Math.log1p(maxWeighted) : 0;

    const growthRatio = (cur.weighted - prev.weighted) / (prev.weighted + 3);
    const volumeGate = Math.min(1, cur.weighted / 3);
    const growth = clamp01((growthRatio + 0.5) / 2.5) * volumeGate;

    let diversity = clamp01(cur.effectiveAuthors / diversityTarget);
    if (cur.authors < 3) diversity *= 0.5;

    const alternationRate = cur.messages > 1 ? cur.alternations / (cur.messages - 1) : 0;
    const debateRaw = (cur.signals.disagreement + 0.4 * cur.signals.agreement + 0.3 * cur.signals.question) / n
      + 0.5 * alternationRate;
    const debate = cur.weighted > 0 ? clamp01(debateRaw / 0.8) : 0;

    const rate = key => (cur.weighted > 0 ? clamp01(cur.signals[key] / n / 0.4) : 0);
    let potential = 0.35 * rate('question') + 0.25 * rate('curiosity') + 0.15 * rate('hype') + 0.25 * topic.visualPotential;
    const learned = performanceByTopic[topic.id];
    if (learned && learned.videos >= 2 && Number.isFinite(learned.performanceIndex)) {
      potential = 0.6 * potential + 0.4 * clamp01(learned.performanceIndex / 2);
    }

    const gtaRate = cur.weighted > 0 ? clamp01(cur.signals.gta / n) : 0;
    const relevance = topic.emergent
      ? clamp01(0.3 + 0.7 * gtaRate)
      : clamp01(topic.relevance * (0.8 + 0.2 * Math.max(gtaRate, 0.5)));

    const components = { frequency, growth, diversity, debate, potential, relevance };
    let score = 0;
    for (const [key, weight] of Object.entries(weights)) score += weight * (components[key] || 0);

    const dominancePenalty = cur.topAuthorShare > 0.5 ? 1 - (cur.topAuthorShare - 0.5) : 1;
    score *= dominancePenalty;
    // A topic nobody discussed in this window cannot rank on potential alone.
    if (cur.weighted === 0) score = 0;

    const dominant = ['question', 'curiosity', 'disagreement', 'hype']
      .map(key => ({ key, value: cur.signals[key] }))
      .sort((a, b) => b.value - a.value)[0];

    return {
      id: topic.id,
      label: topic.label,
      emergent: Boolean(topic.emergent),
      risk: topic.risk,
      keywords: topic.keywords.slice(0, 8),
      score: round(score * 100, 1),
      components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, round(value)])),
      dominancePenalty: round(dominancePenalty),
      confidence: confidenceOf(cur),
      dominantSignal: dominant && dominant.value > 0 ? dominant.key : 'discussion',
      growthRatio: round(growthRatio),
      current: cur,
      previous: prev
    };
  }).sort((a, b) => b.score - a.score);
}

function weeklySeries(labeled, topicIds, asOfMs, weeks) {
  const series = {};
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const end = asOfMs - i * 7 * DAY_MS;
    buckets.push({ start: end - 7 * DAY_MS, end, label: new Date(end).toISOString().slice(0, 10) });
  }
  for (const topicId of topicIds) {
    series[topicId] = buckets.map(bucket => {
      let weighted = 0;
      for (const message of labeled) {
        if (message.ms > bucket.start && message.ms <= bucket.end && message.topics.has(topicId)) {
          weighted += message.topics.get(topicId);
        }
      }
      return round(weighted, 1);
    });
  }
  return { weeks: buckets.map(bucket => bucket.label), series };
}

/**
 * Run the full analysis.
 * @param {object} input
 * @param {Array} input.messages   stored messages { id, ts, author, text }
 * @param {Array} input.taxonomy   compiled taxonomy topics
 * @param {string} [input.asOf]    YYYY-MM-DD (defaults to last message day)
 * @param {number} [input.windowDays=7]
 * @param {object} [input.performanceByTopic]  learned performance per topic
 */
function analyze(input) {
  const windowDays = input.windowDays || 7;
  const asOfMs = resolveAsOf(input.messages, input.asOf);
  const windowMs = windowDays * DAY_MS;
  const labeled = labelMessages(input.messages, input.taxonomy);
  const current = windowOf(labeled, asOfMs - windowMs, asOfMs);
  const previous = windowOf(labeled, asOfMs - 2 * windowMs, asOfMs - windowMs);

  const emergentTopics = detectEmergentTopics(labeled, current, previous, input.taxonomy, input.emergentLimits);
  const allTopics = [...input.taxonomy, ...emergentTopics];
  const activeAuthors = new Set(current.map(message => message.author)).size;

  const ranking = scoreTopics(allTopics, current, previous, {
    activeAuthors,
    performanceByTopic: input.performanceByTopic,
    weights: input.weights || DEFAULT_WEIGHTS
  });

  const emergingTrends = ranking
    .filter(row => row.current.messages >= 5 && row.current.authors >= 3
      && (row.emergent || row.components.growth >= 0.6))
    .sort((a, b) => (b.components.growth * b.components.diversity) - (a.components.growth * a.components.diversity))
    .map(row => row.id);

  const history = weeklySeries(labeled, ranking.map(row => row.id), asOfMs, 8);
  const unlabeled = current.filter(message => message.topics.size === 0).length;

  return {
    asOf: new Date(asOfMs).toISOString().slice(0, 10),
    windowDays,
    window: {
      start: new Date(asOfMs - windowMs).toISOString().slice(0, 10),
      end: new Date(asOfMs).toISOString().slice(0, 10),
      messages: current.length,
      activeParticipants: activeAuthors,
      previousMessages: previous.length,
      previousParticipants: new Set(previous.map(message => message.author)).size,
      unlabeledMessages: unlabeled
    },
    ranking,
    emergingTrends,
    history
  };
}

module.exports = {
  DEFAULT_WEIGHTS,
  EMERGENT_LIMITS,
  analyze,
  labelMessages,
  scoreTopics,
  detectEmergentTopics,
  aggregateTopic
};
