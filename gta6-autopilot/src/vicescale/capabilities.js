// Camada de abstração: o restante do Autopilot pede CAPACIDADES com nomes e
// campos estáveis em inglês; só este arquivo conhece os nomes e os parâmetros
// em português das ferramentas MCP da ViceScale. Se a ViceScale renomear uma
// ferramenta, muda-se apenas aqui.

const omitUndefined = (obj) => Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));

export const CAPABILITIES = {
  'account.status': { tool: 'status', map: () => ({}) },

  'source.instagramProfileVideos': {
    tool: 'buscar_perfil',
    map: ({ username, limit }) => omitUndefined({ usuario: username, quantidade: limit }),
  },
  'source.instagramProfilePosts': {
    tool: 'buscar_fotos_perfil',
    map: ({ username, postUrl, limit }) => omitUndefined({ usuario: username, url: postUrl, quantidade: limit }),
  },

  'media.resolveUrl': { tool: 'resolver_video', map: ({ url }) => ({ url }) },
  'media.import': { tool: 'baixar_video', map: ({ url }) => ({ url }) },

  'template.listProfiles': { tool: 'listar_perfis_template', map: () => ({}) },
  'template.listTextStyles': { tool: 'listar_estilos_texto', map: () => ({}) },

  'copy.suggestPhrases': {
    tool: 'sugerir_frases',
    map: ({ topic, count }) => omitUndefined({ tema: topic, quantidade: count }),
  },
  'copy.suggestHeadlines': {
    tool: 'sugerir_headlines',
    map: ({ topic, mode, count }) => omitUndefined({ tema: topic, modo: mode, quantidade: count }),
  },

  'post.create': {
    tool: 'criar_post_template',
    map: ({ name, videos, phrases, style, mode, profileId, textStyleId }) =>
      omitUndefined({
        nome: name,
        videos: videos?.map((v) => omitUndefined({ storagePath: v.storagePath, duracaoSegundos: v.durationSeconds })),
        frases: phrases,
        estilo: style,
        modo: mode,
        perfilId: profileId,
        estiloTextoId: textStyleId,
      }),
  },
  'post.render': { tool: 'renderizar_post_template', map: ({ projectId }) => ({ projectId }) },
  'post.status': { tool: 'status_post_template', map: ({ projectId }) => ({ projectId }) },
  'post.list': { tool: 'listar_projetos_template', map: ({ limit } = {}) => omitUndefined({ limite: limit }) },

  'scale.list': { tool: 'listar_projetos_scale', map: ({ limit } = {}) => omitUndefined({ limite: limit }) },

  'repost.create': { tool: 'criar_repost', map: ({ url }) => ({ url }) },
  'repost.translateCaption': { tool: 'traduzir_legenda_repost', map: ({ projectId }) => ({ projectId }) },
  'repost.rewriteCaption': { tool: 'reescrever_legenda_repost', map: ({ projectId }) => ({ projectId }) },
  'repost.translateImage': { tool: 'traduzir_imagem_repost', map: ({ projectId }) => ({ projectId }) },
  'repost.status': { tool: 'status_repost', map: ({ projectId }) => ({ projectId }) },
  'repost.list': { tool: 'listar_reposts', map: ({ limit } = {}) => omitUndefined({ limite: limit }) },

  'publish.video': {
    tool: 'publicar_template',
    map: ({ projectId, platform, caption, scheduleAt, timezone, variationIndex }) =>
      omitUndefined({
        projectId,
        plataforma: platform,
        legenda: caption,
        agendarPara: scheduleAt,
        timezone,
        variationIndex,
      }),
  },
  'publish.image': {
    tool: 'publicar_repost',
    map: ({ projectId, platform, caption, scheduleAt, timezone }) =>
      omitUndefined({ projectId, plataforma: platform, legenda: caption, agendarPara: scheduleAt, timezone }),
  },
};

// Capacidades que o Autopilot precisa mas a ViceScale NÃO expõe via MCP
// (verificado em 2026-11-18). Chamá-las gera CapabilityUnavailableError com a
// alternativa — nunca um resultado simulado.
export const UNAVAILABLE = {
  'publish.tiktok': {
    reason: 'publicar_template/publicar_repost aceitam apenas instagram, youtube e facebook; TikTok exige consentimento no painel.',
    alternative: 'Cut.Pro POST /posts (TikTok suportado na API; ver docs/CUTPRO_API_INTEGRATION.md). Sem Cut.Pro: fila manual pelo painel ViceScale.',
  },
  'analytics.postMetrics': {
    reason: 'Nenhuma ferramenta MCP retorna visualizações, curtidas, retenção ou receita.',
    alternative: 'Cut.Pro (a confirmar no openapi.json) ou YouTube Analytics API / TikTok Display API.',
  },
  'trends.tiktok': {
    reason: 'Não há ferramenta de tendências do TikTok.',
    alternative: 'Fontes autorizadas próprias (RSS/APIs oficiais) no agente Scout.',
  },
  'trends.youtube': {
    reason: 'Não há ferramenta de tendências do YouTube.',
    alternative: 'YouTube Data API v3 (search.list / videos.list com chave de API).',
  },
  'scale.create': {
    reason: 'Só existe listar_projetos_scale; criar/renderizar projetos Scale e o Editor de clipes são exclusivos do painel web.',
    alternative: 'post.create com estilo "original" ou "twitter" (Templates) via MCP.',
  },
  'media.upload': {
    reason: 'Vídeos só entram via link de Instagram/TikTok (baixar_video); não há upload de arquivo próprio.',
    alternative: 'Cut.Pro POST /videos/upload (arquivo próprio, inclusive MP4 já editado com destination "editor").',
  },
  'publish.listScheduled': {
    reason: 'Não há ferramenta para listar, cancelar ou reprogramar agendamentos.',
    alternative: 'Registro local das publicações (tabela operations) + cancelamento manual no painel.',
  },
};

export const resolveCapability = (name) => CAPABILITIES[name];
export const unavailableCapability = (name) => UNAVAILABLE[name];
