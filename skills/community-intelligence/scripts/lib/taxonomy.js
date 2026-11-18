'use strict';

/**
 * GTA 6 topic taxonomy (pt-BR + en keywords).
 *
 * relevance       0..1  how central the topic is to GTA 6 content
 * visualPotential 0..1  how well the topic turns into short-form video
 * risk            'normal' | 'rumor'  rumor topics must never be stated as fact
 *
 * Extend or override per project with <data-dir>/taxonomy.json:
 *   { "topics": [{ "id": "...", "label": "...", "keywords": [...], ... }] }
 * Entries with an existing id replace the built-in definition.
 */

const fs = require('fs');
const path = require('path');
const { buildKeywordRegex, normalize } = require('./text');

const GTA_ANCHORS = [
  'gta', 'gta 6', 'gta vi', 'gta6', 'grand theft auto', 'rockstar', 'vice city', 'leonida',
  'lucia', 'jason', 'take-two', 'take two'
];

const BUILT_IN_TOPICS = [
  {
    id: 'release-date',
    label: 'Data de lançamento e adiamentos',
    keywords: ['lancamento', 'lanca', 'lancar', 'data de lancamento', 'adiamento', 'adiado', 'adiaram',
      'adiar', 'delay', 'delayed', 'release date', 'pre-venda', 'pre venda', 'pre-order', 'preorder',
      'pre order', 'quando sai', 'vai sair', 'saiu a data', 'launch'],
    relevance: 1, visualPotential: 0.6, risk: 'normal'
  },
  {
    id: 'trailers',
    label: 'Trailers e materiais oficiais',
    keywords: ['trailer', 'trailers', 'teaser', 'trailer 3', 'trailer 2', 'screenshot', 'screenshots',
      'capturas', 'newswire', 'material oficial', 'artwork', 'arte oficial'],
    relevance: 1, visualPotential: 1, risk: 'normal'
  },
  {
    id: 'price-editions',
    label: 'Preço e edições',
    keywords: ['preco', 'precos', 'quanto vai custar', 'custar', 'valor do jogo', 'reais', 'r$', 'dolares',
      '$70', '$80', '$100', 'edicao', 'edicoes', 'deluxe', 'colecionador', 'collector', 'price', 'pricing'],
    relevance: 0.95, visualPotential: 0.5, risk: 'normal'
  },
  {
    id: 'map-world',
    label: 'Mapa, Vice City e Leonida',
    keywords: ['mapa', 'map', 'vice city', 'leonida', 'miami', 'florida', 'florida keys', 'everglades', 'pantano',
      'praia', 'praias', 'interiores', 'tamanho do mapa', 'map size', 'port gellhorn', 'ambrosia'],
    relevance: 1, visualPotential: 1, risk: 'normal'
  },
  {
    id: 'characters-story',
    label: 'Personagens e história',
    keywords: ['lucia', 'jason', 'protagonista', 'protagonistas', 'personagem', 'personagens', 'historia',
      'enredo', 'campanha', 'roteiro', 'story', 'character', 'characters', 'vilao', 'casal'],
    relevance: 1, visualPotential: 0.9, risk: 'normal'
  },
  {
    id: 'gameplay-mechanics',
    label: 'Gameplay e mecânicas',
    keywords: ['gameplay', 'mecanica', 'mecanicas', 'missao', 'missoes', 'assalto', 'assaltos', 'heist',
      'tiroteio', 'combate', 'fisica', 'direcao', 'dirigir', 'ia dos npcs', 'npc', 'npcs', 'sistema de procurado',
      'procurado', 'policia', 'wanted', 'stealth', 'furtividade', 'mechanics', 'inventario'],
    relevance: 1, visualPotential: 0.9, risk: 'normal'
  },
  {
    id: 'vehicles',
    label: 'Veículos',
    keywords: ['carro', 'carros', 'veiculo', 'veiculos', 'moto', 'motos', 'barco', 'barcos', 'aviao',
      'avioes', 'helicoptero', 'lancha', 'supercarro', 'tuning', 'customizacao', 'vehicle', 'vehicles', 'cars'],
    relevance: 0.9, visualPotential: 1, risk: 'normal'
  },
  {
    id: 'wildlife-world-details',
    label: 'Fauna, clima e detalhes do mundo',
    keywords: ['jacare', 'jacares', 'crocodilo', 'alligator', 'animais', 'animal', 'fauna', 'clima',
      'furacao', 'chuva', 'tempestade', 'weather', 'reflexo', 'reflexos', 'iluminacao', 'graficos',
      'grafico', 'realismo', 'realista'],
    relevance: 0.9, visualPotential: 1, risk: 'normal'
  },
  {
    id: 'easter-eggs',
    label: 'Easter eggs e segredos',
    keywords: ['easter egg', 'easter eggs', 'segredo', 'segredos', 'referencia', 'referencias', 'misterio',
      'misterios', 'teoria', 'teorias', 'escondido', 'hidden', 'secret', 'theory'],
    relevance: 0.95, visualPotential: 1, risk: 'normal'
  },
  {
    id: 'online-multiplayer',
    label: 'GTA Online e multiplayer',
    keywords: ['gta online', 'online', 'multiplayer', 'servidor', 'servidores', 'roleplay', 'rp', 'fivem',
      'crossplay', 'cross-play', 'shark card', 'shark cards', 'microtransacao', 'microtransacoes'],
    relevance: 0.9, visualPotential: 0.7, risk: 'normal'
  },
  {
    id: 'platforms-performance',
    label: 'Plataformas e desempenho',
    keywords: ['ps5', 'ps5 pro', 'playstation', 'xbox', 'series s', 'series x', 'pc', 'steam', 'switch 2',
      'fps', '30fps', '60fps', '30 fps', '60 fps', 'resolucao', '4k', 'desempenho', 'performance',
      'otimizacao', 'requisitos', 'placa de video', 'console', 'consoles'],
    relevance: 0.95, visualPotential: 0.6, risk: 'normal'
  },
  {
    id: 'leaks-rumors',
    label: 'Vazamentos e rumores',
    keywords: ['vazamento', 'vazamentos', 'vazou', 'vazado', 'leak', 'leaks', 'leaked', 'rumor', 'rumores',
      'boato', 'boatos', 'insider', 'insiders', 'fonte anonima', 'fake', 'falso', 'mentira', 'hoax'],
    relevance: 0.85, visualPotential: 0.6, risk: 'rumor'
  },
  {
    id: 'soundtrack-radio',
    label: 'Trilha sonora e rádios',
    keywords: ['radio', 'radios', 'trilha', 'trilha sonora', 'musica', 'musicas', 'soundtrack', 'song',
      'cancao', 'artista', 'artistas', 'dj'],
    relevance: 0.85, visualPotential: 0.8, risk: 'normal'
  },
  {
    id: 'rockstar-business',
    label: 'Rockstar, Take-Two e mercado',
    keywords: ['rockstar', 'take-two', 'take two', 'strauss', 'zelnick', 'acoes', 'investidores', 'balanco',
      'earnings', 'resultado trimestral', 'fiscal', 'vendas', 'orcamento', 'budget', 'demissoes', 'estudio'],
    relevance: 0.8, visualPotential: 0.4, risk: 'normal'
  },
  {
    id: 'franchise-comparisons',
    label: 'Comparações com outros jogos da franquia',
    keywords: ['gta 5', 'gta v', 'gta san andreas', 'san andreas', 'gta iv', 'gta 4', 'vice city original',
      'red dead', 'rdr2', 'rdr 2', 'comparacao', 'comparando', 'comparison', 'versus', 'melhor que'],
    relevance: 0.75, visualPotential: 0.8, risk: 'normal'
  },
  {
    id: 'creator-strategy',
    label: 'Estratégia de criadores (TikTok/Shorts)',
    keywords: ['tiktok', 'shorts', 'youtube shorts', 'reels', 'algoritmo', 'alcance', 'viralizar',
      'viralizou', 'viral', 'engajamento', 'retencao', 'monetizacao', 'monetizar', 'views', 'visualizacoes',
      'seguidores', 'thumbnail', 'gancho', 'hook', 'edicao de video', 'postar', 'postagem', 'canal'],
    relevance: 0.5, visualPotential: 0.4, risk: 'normal'
  }
];

function compileTopic(topic) {
  return {
    ...topic,
    relevance: clamp01(topic.relevance === undefined || topic.relevance === null ? 0.7 : topic.relevance),
    visualPotential: clamp01(topic.visualPotential === undefined || topic.visualPotential === null ? 0.6 : topic.visualPotential),
    risk: topic.risk === 'rumor' ? 'rumor' : 'normal',
    regex: buildKeywordRegex(topic.keywords || [])
  };
}

function clamp01(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function loadTaxonomy(dataDir) {
  const byId = new Map(BUILT_IN_TOPICS.map(topic => [topic.id, topic]));
  if (dataDir) {
    const overridePath = path.join(dataDir, 'taxonomy.json');
    if (fs.existsSync(overridePath)) {
      const parsed = JSON.parse(fs.readFileSync(overridePath, 'utf8'));
      for (const topic of parsed.topics || []) {
        if (!topic || typeof topic.id !== 'string' || !Array.isArray(topic.keywords)) {
          throw new Error('taxonomy.json: each topic needs a string "id" and a "keywords" array');
        }
        byId.set(topic.id, { label: topic.id, ...topic });
      }
    }
  }
  return Array.from(byId.values()).map(compileTopic);
}

const GTA_ANCHOR_REGEX = buildKeywordRegex(GTA_ANCHORS);

function mentionsGta(normalizedText) {
  GTA_ANCHOR_REGEX.lastIndex = 0;
  return GTA_ANCHOR_REGEX.test(normalizedText);
}

function taxonomyKeywordSet(topics) {
  const set = new Set();
  for (const topic of topics) {
    for (const keyword of topic.keywords) {
      for (const part of normalize(keyword).split(/\s+/)) set.add(part);
    }
  }
  for (const anchor of GTA_ANCHORS) {
    for (const part of normalize(anchor).split(/\s+/)) set.add(part);
  }
  return set;
}

module.exports = {
  BUILT_IN_TOPICS,
  GTA_ANCHORS,
  loadTaxonomy,
  mentionsGta,
  taxonomyKeywordSet,
  clamp01
};
