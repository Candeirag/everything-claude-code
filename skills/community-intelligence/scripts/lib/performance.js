'use strict';

/**
 * Video performance and the learning loop.
 *
 * videos.json holds every tracked video (TikTok / YouTube Shorts). Videos born
 * from community discussions carry origin "community" and a topicId; other
 * channel videos (origin "other") form the baseline that performance is
 * compared against. Metrics are imported from platform exports (CSV/JSON):
 * the agent never scrapes accounts.
 */

const fs = require('fs');

const PLATFORMS = ['tiktok', 'youtube_shorts'];
const METRIC_FIELDS = ['views', 'likes', 'comments', 'shares', 'saves', 'avgWatchPct', 'followersGained'];

const CSV_ALIASES = {
  video_id: 'videoId', videoid: 'videoId', id: 'videoId',
  platform: 'platform', plataforma: 'platform',
  topic_id: 'topicId', topic: 'topicId', tema: 'topicId',
  suggestion_id: 'suggestionId',
  title: 'title', titulo: 'title',
  published_at: 'publishedAt', publicado_em: 'publishedAt',
  views: 'views', visualizacoes: 'views', plays: 'views',
  likes: 'likes', curtidas: 'likes',
  comments: 'comments', comentarios: 'comments',
  shares: 'shares', compartilhamentos: 'shares',
  saves: 'saves', salvamentos: 'saves', favorites: 'saves',
  avg_watch_pct: 'avgWatchPct', average_watch_pct: 'avgWatchPct', retencao: 'avgWatchPct',
  followers_gained: 'followersGained', seguidores_ganhos: 'followersGained',
  captured_at: 'capturedAt', coletado_em: 'capturedAt'
};

function normalizePlatform(value) {
  const v = String(value || '').toLowerCase().replace(/[\s-]+/g, '_');
  if (v === 'tiktok' || v === 'tt') return 'tiktok';
  if (['youtube_shorts', 'shorts', 'youtube', 'yt_shorts', 'yt'].includes(v)) return 'youtube_shorts';
  throw new Error(`Plataforma inválida: "${value}" (use tiktok ou youtube_shorts)`);
}

function parseCsv(text) {
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const delimiter = firstLine.includes(';') && !firstLine.includes(',') ? ';' : ',';
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (char === '"') { quoted = false; } else { field += char; }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(cell => cell.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some(cell => cell.trim() !== '')) rows.push(row);
  if (rows.length === 0) return [];
  const header = rows[0].map(cell => cell.trim().toLowerCase().replace(/\s+/g, '_'));
  return rows.slice(1).map(cells => {
    const record = {};
    header.forEach((name, index) => {
      const key = CSV_ALIASES[name] || name;
      record[key] = (cells[index] || '').trim();
    });
    return record;
  });
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number') return value;
  const cleaned = String(value).replace(/%$/, '').replace(/\s/g, '');
  let normalized;
  if (/,\d{1,2}$/.test(cleaned)) normalized = cleaned.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(cleaned)) normalized = cleaned.replace(/\./g, '');
  else normalized = cleaned.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function readMetricsFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const trimmed = text.trim();
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed.videos || [];
  }
  return parseCsv(text);
}

function emptyVideos() {
  return { schemaVersion: 1, videos: [] };
}

function videoKey(platform, videoId) {
  return `${platform}:${videoId}`;
}

/** Link a published video to a community topic (and optionally a suggestion). */
function linkVideo(videosDoc, input) {
  if (!input.videoId) throw new Error('--video-id é obrigatório');
  const platform = normalizePlatform(input.platform);
  const key = videoKey(platform, input.videoId);
  const existing = videosDoc.videos.find(video => videoKey(video.platform, video.videoId) === key);
  const base = existing || { videoId: String(input.videoId), platform, metrics: {}, metricsHistory: [] };
  const updated = {
    ...base,
    origin: input.topicId ? 'community' : (base.origin || 'other'),
    topicId: input.topicId || base.topicId || null,
    suggestionId: input.suggestionId || base.suggestionId || null,
    title: input.title || base.title || null,
    publishedAt: input.publishedAt || base.publishedAt || null,
    communityScoreAtSuggestion: input.communityScore !== undefined && input.communityScore !== null ? Number(input.communityScore) : (base.communityScoreAtSuggestion ?? null)
  };
  const videos = existing
    ? videosDoc.videos.map(video => (video === existing ? updated : video))
    : [...videosDoc.videos, updated];
  return { doc: { ...videosDoc, videos }, video: updated };
}

/** Merge metric rows into videos.json; unknown videos join the baseline. */
function importMetrics(videosDoc, records, nowIso) {
  let doc = videosDoc;
  let updated = 0;
  for (const record of records) {
    if (!record.videoId || !record.platform) continue;
    const linked = linkVideo(doc, {
      videoId: record.videoId,
      platform: record.platform,
      topicId: record.topicId || undefined,
      suggestionId: record.suggestionId || undefined,
      title: record.title || undefined,
      publishedAt: record.publishedAt || undefined
    });
    const metrics = {};
    for (const field of METRIC_FIELDS) {
      const value = toNumber(record[field]);
      if (value !== null) metrics[field] = value;
    }
    const capturedAt = record.capturedAt || nowIso;
    const video = {
      ...linked.video,
      metrics: { ...linked.video.metrics, ...metrics },
      metricsUpdatedAt: capturedAt,
      metricsHistory: [...(linked.video.metricsHistory || []), { capturedAt, ...metrics }].slice(-30)
    };
    doc = { ...linked.doc, videos: linked.doc.videos.map(item => (item === linked.video ? video : item)) };
    updated++;
  }
  return { doc, updated };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function engagementRate(metrics) {
  if (!metrics || !metrics.views) return null;
  const interactions = (metrics.likes || 0) + (metrics.comments || 0) + (metrics.shares || 0) + (metrics.saves || 0);
  return interactions / metrics.views;
}

function round(value, digits = 3) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Performance index of one video vs. the platform baseline (1.0 = typical). */
function performanceIndex(video, baseline) {
  const views = video.metrics && video.metrics.views;
  if (!views || !baseline || !baseline.medianViews) return null;
  const viewRatio = views / baseline.medianViews;
  const eng = engagementRate(video.metrics);
  const engRatio = eng !== null && baseline.medianEngagement ? eng / baseline.medianEngagement : 1;
  return Math.sqrt(Math.max(viewRatio, 0.0001) * Math.max(engRatio, 0.0001));
}

function spearman(pairs) {
  if (pairs.length < 5) return null;
  const rank = values => {
    const sorted = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
    const ranks = new Array(values.length);
    for (let i = 0; i < sorted.length;) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1].value === sorted[i].value) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) ranks[sorted[k].index] = avg;
      i = j + 1;
    }
    return ranks;
  };
  const xs = rank(pairs.map(pair => pair[0]));
  const ys = rank(pairs.map(pair => pair[1]));
  const mean = arr => arr.reduce((sum, value) => sum + value, 0) / arr.length;
  const mx = mean(xs);
  const my = mean(ys);
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : null;
}

/**
 * Summarize performance: per platform baseline, per topic (overall and per
 * platform), community vs. other videos, and whether community score predicts
 * results.
 */
function summarizePerformance(videosDoc) {
  const videos = videosDoc.videos || [];
  const baselines = {};
  for (const platform of PLATFORMS) {
    const onPlatform = videos.filter(video => video.platform === platform && video.metrics && video.metrics.views);
    baselines[platform] = {
      videos: onPlatform.length,
      medianViews: median(onPlatform.map(video => video.metrics.views)),
      medianEngagement: median(onPlatform.map(video => engagementRate(video.metrics)))
    };
  }

  const scored = videos.map(video => ({
    ...video,
    engagementRate: round(engagementRate(video.metrics), 4),
    performanceIndex: round(performanceIndex(video, baselines[video.platform]), 3)
  }));

  const byTopic = {};
  for (const video of scored.filter(item => item.origin === 'community' && item.topicId)) {
    const topic = byTopic[video.topicId] || { videos: 0, indices: [], platforms: {} };
    topic.videos++;
    if (video.performanceIndex !== null) topic.indices.push(video.performanceIndex);
    const platform = topic.platforms[video.platform] || { videos: 0, indices: [], views: [] };
    platform.videos++;
    if (video.performanceIndex !== null) platform.indices.push(video.performanceIndex);
    if (video.metrics && video.metrics.views) platform.views.push(video.metrics.views);
    topic.platforms[video.platform] = platform;
    byTopic[video.topicId] = topic;
  }

  const performanceByTopic = {};
  for (const [topicId, topic] of Object.entries(byTopic)) {
    performanceByTopic[topicId] = {
      videos: topic.videos,
      performanceIndex: round(median(topic.indices), 3),
      platforms: Object.fromEntries(Object.entries(topic.platforms).map(([platform, data]) => [platform, {
        videos: data.videos,
        performanceIndex: round(median(data.indices), 3),
        medianViews: median(data.views)
      }]))
    };
  }

  const community = scored.filter(video => video.origin === 'community');
  const other = scored.filter(video => video.origin !== 'community');
  const pairs = community
    .filter(video => Number.isFinite(video.communityScoreAtSuggestion) && video.performanceIndex !== null)
    .map(video => [video.communityScoreAtSuggestion, video.performanceIndex]);

  const leaderboard = {};
  for (const platform of PLATFORMS) {
    leaderboard[platform] = Object.entries(performanceByTopic)
      .filter(([, data]) => data.platforms[platform] && data.platforms[platform].performanceIndex !== null)
      .map(([topicId, data]) => ({ topicId, ...data.platforms[platform] }))
      .sort((a, b) => b.performanceIndex - a.performanceIndex);
  }

  return {
    baselines,
    videos: scored,
    performanceByTopic,
    leaderboard,
    communityVsOther: {
      community: { videos: community.length, medianIndex: round(median(community.map(v => v.performanceIndex)), 3) },
      other: { videos: other.length, medianIndex: round(median(other.map(v => v.performanceIndex)), 3) }
    },
    scorePredictsPerformance: {
      pairs: pairs.length,
      spearman: round(spearman(pairs), 3),
      note: pairs.length < 5 ? 'Amostra insuficiente (mínimo 5 vídeos com score registrado).' : null
    }
  };
}

module.exports = {
  PLATFORMS,
  emptyVideos,
  normalizePlatform,
  parseCsv,
  readMetricsFile,
  linkVideo,
  importMetrics,
  summarizePerformance,
  engagementRate,
  spearman
};
