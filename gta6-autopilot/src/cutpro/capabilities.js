// Capacidades estáveis do Autopilot sobre a API da Cut.Pro. Os agentes usam
// nomes e campos daqui; só este arquivo conhece operationIds e formatos da API.

const omitUndefined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

// YouTube "Gaming" = categoryId 20 (lista oficial de categorias do YouTube).
export const YOUTUBE_GAMING_CATEGORY = '20';

const tiktokMetadata = ({ title, privacy = 'PUBLIC_TO_EVERYONE', isAigc, disableDuet, disableStitch, disableComment }) =>
  omitUndefined({ title, privacyLevel: privacy, isAigc, disableDuet, disableStitch, disableComment });

const youtubeMetadata = ({ title, description, tags, privacy = 'public', categoryId = YOUTUBE_GAMING_CATEGORY, madeForKids = false }) =>
  omitUndefined({ title, description, tags, privacyStatus: privacy, categoryId, madeForKids });

const METADATA_BUILDERS = { tiktok: tiktokMetadata, youtube: youtubeMetadata };

export const CAPABILITIES = {
  'account.workspace': { tool: 'getWorkspace', map: () => ({}) },
  'account.connections': { tool: 'listConnections', map: ({ platform } = {}) => omitUndefined({ platform }) },
  'account.connectLink': { tool: 'getConnectionLink', map: ({ platform }) => ({ platform }) },
  'account.renderLimits': { tool: 'getRenderLimits', map: () => ({}) },

  'source.analyze': { tool: 'analyzeVideo', map: ({ url }) => ({ body: { url } }) },
  'source.searchChannels': { tool: 'searchChannels', map: ({ platform, query }) => ({ platform, q: query }) },
  'source.discoverLives': { tool: 'discoverLives', map: () => ({}) },

  'monitor.list': { tool: 'listMonitors', map: ({ type } = {}) => omitUndefined({ type }) },
  'monitor.create': {
    tool: 'createMonitor',
    map: ({ channelUrl, creatorId, type, enabled, strategyId, templateId, minDurationSeconds, maxDurationSeconds }) => ({
      body: omitUndefined({
        channel: channelUrl,
        creator_id: creatorId,
        type,
        enabled,
        strategy_id: strategyId,
        template_id: templateId,
        video_min_duration: minDurationSeconds,
        video_max_duration: maxDurationSeconds,
      }),
    }),
  },
  'monitor.start': { tool: 'startMonitor', map: ({ monitorId }) => ({ id: monitorId }) },
  'monitor.stop': { tool: 'stopMonitor', map: ({ monitorId }) => ({ id: monitorId }) },
  'monitor.get': { tool: 'getMonitor', map: ({ monitorId }) => ({ id: monitorId }) },
  'monitor.broadcast': { tool: 'getBroadcast', map: ({ monitorId, broadcastId }) => ({ id: monitorId, broadcastId }) },
  'monitor.broadcasts': { tool: 'listBroadcasts', map: ({ monitorId, limit }) => omitUndefined({ id: monitorId, limit }) },
  'monitor.broadcastClips': {
    tool: 'listBroadcastClips',
    map: ({ monitorId, broadcastId, minRating, limit, page }) =>
      omitUndefined({ id: monitorId, broadcastId, min_rating: minRating, limit, page, sort: 'rating', order: 'desc' }),
  },
  'monitor.renderClip': {
    tool: 'renderBroadcastClip',
    map: ({ monitorId, broadcastId, clipId }) => ({ id: monitorId, broadcastId, clipId }),
  },

  'clip.submit': {
    tool: 'createSubmission',
    map: ({ videoId, language = 'pt', startSeconds, endSeconds, templateId, strategyId }) => ({
      videoId,
      body: omitUndefined({
        source_language: language,
        timeframe: startSeconds !== undefined && endSeconds !== undefined ? { start: startSeconds, end: endSeconds } : undefined,
        template_id: templateId,
        strategy_id: strategyId,
      }),
    }),
  },
  'clip.submissionStatus': { tool: 'getSubmission', map: ({ videoId, submissionId }) => ({ videoId, submissionId }) },
  'clip.list': {
    tool: 'listClips',
    map: ({ videoId, submissionId, minRating, limit, page }) =>
      omitUndefined({ videoId, submissionId, min_rating: minRating, limit, page, sort: 'rating', order: 'desc' }),
  },
  'clip.subtitles': {
    tool: 'downloadClipSubtitles',
    map: ({ videoId, submissionId, clipId, format = 'srt' }) => ({ videoId, submissionId, clipId, format }),
  },
  'clip.suggestTitles': {
    tool: 'suggestClipTitles',
    map: ({ videoId, submissionId, clipId }) => ({ videoId, submissionId, clipId }),
  },
  'clip.feedback': {
    tool: 'rateClip',
    map: ({ videoId, submissionId, clipId, feedback, reason }) => ({
      videoId,
      submissionId,
      clipId,
      body: omitUndefined({ feedback, reason }),
    }),
  },

  'strategy.list': { tool: 'listStrategies', map: () => ({}) },
  'strategy.create': {
    tool: 'createStrategy',
    map: ({ name, focus, titleStyle, minSeconds, maxSeconds }) => ({
      body: omitUndefined({ name, clip_focus: focus, title_style: titleStyle, clip_min_length: minSeconds, clip_max_length: maxSeconds }),
    }),
  },
  'template.list': { tool: 'listTemplates', map: ({ filter = 'mine' } = {}) => ({ filter }) },

  'render.clip': { tool: 'renderClip', map: ({ videoId, submissionId, clipId }) => ({ videoId, submissionId, clipId }) },
  'render.edit': { tool: 'createRender', map: ({ editId }) => ({ body: { edit_id: editId } }) },
  'render.status': { tool: 'getRender', map: ({ renderId }) => ({ renderId }) },
  'render.download': { tool: 'downloadRender', map: ({ renderId }) => ({ renderId }) },

  'copy.postDescription': {
    tool: 'writePostDescription',
    map: ({ editId, platforms, prompt }) => ({ body: omitUndefined({ edit_id: editId, platforms, prompt }) }),
  },

  /**
   * targets: [{ connectionId, platform: 'tiktok'|'youtube', title, description?, tags?, privacy? }]
   * scheduledAt: ISO 8601 no futuro (obrigatório, salvo context.allowImmediate)
   */
  'publish.post': {
    tool: 'createPost',
    map: ({ editId, targets, scheduledAt }) => ({
      body: omitUndefined({
        videos: [
          {
            edit_id: editId,
            targets: targets.map(({ connectionId, platform, ...fields }) => {
              const build = METADATA_BUILDERS[platform];
              if (!build) throw new Error(`Plataforma sem metadados configurados: ${platform}`);
              return { connection_id: connectionId, metadata: { [platform]: build(fields) } };
            }),
          },
        ],
        scheduled_at: scheduledAt,
      }),
    }),
  },
  'publish.status': { tool: 'getPost', map: ({ postId }) => ({ id: postId }) },
  'publish.usage': { tool: 'getPostUsage', map: () => ({}) },
  'publish.bestTime': { tool: 'getBestPostTime', map: ({ connectionIds }) => ({ connection_ids: connectionIds.join(',') }) },
  'publish.cancel': { tool: 'cancelPost', map: ({ postId, editId }) => omitUndefined({ id: postId, edit_id: editId }) },
  'publish.deleteItem': { tool: 'deletePostItem', map: ({ postId, itemId }) => ({ id: postId, itemId }) },

  // Métricas disponíveis no contrato: só agregados da conta (seguidores, posts, curtidas).
  'analytics.accountSnapshot': { tool: 'listConnections', map: () => ({}) },
};

export const UNAVAILABLE = {
  'analytics.postMetrics': {
    reason: 'O contrato openapi.json v1.0.0 não tem rota de métricas por post (visualizações, retenção, curtidas por vídeo).',
    alternative: 'YouTube Data API v3 (videos.list part=statistics, com o published_url do post) e TikTok Display API (OAuth).',
  },
};
