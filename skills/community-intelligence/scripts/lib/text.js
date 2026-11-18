'use strict';

/**
 * Text normalization helpers shared by the Community Intelligence pipeline.
 * Matching is accent-insensitive and case-insensitive (pt-BR + en).
 */

const STOPWORDS = new Set([
  // pt-BR
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na',
  'nos', 'nas', 'por', 'pelo', 'pela', 'pelos', 'pelas', 'para', 'pra', 'pro', 'com', 'sem', 'sob',
  'e', 'ou', 'mas', 'que', 'se', 'nao', 'sim', 'ja', 'so', 'mais', 'menos', 'muito', 'muita', 'muitos',
  'pouco', 'bem', 'mal', 'eu', 'tu', 'ele', 'ela', 'nos', 'voces', 'voce', 'vc', 'vcs', 'eles', 'elas',
  'me', 'te', 'lhe', 'meu', 'minha', 'seu', 'sua', 'dele', 'dela', 'isso', 'isto', 'aquilo', 'esse',
  'essa', 'este', 'esta', 'aquele', 'aquela', 'ai', 'la', 'aqui', 'ali', 'entao', 'tambem', 'tb', 'tbm',
  'ate', 'quando', 'como', 'onde', 'qual', 'quais', 'quem', 'porque', 'pq', 'porem', 'ser', 'estar',
  'ter', 'tem', 'tinha', 'foi', 'era', 'sao', 'esta', 'estao', 'vai', 'vao', 'vou', 'fica', 'fez',
  'faz', 'fazer', 'dar', 'deu', 'acho', 'ainda', 'agora', 'hoje', 'ontem', 'amanha', 'gente', 'galera',
  'pessoal', 'tipo', 'coisa', 'coisas', 'cara', 'mano', 'kkk', 'kkkk', 'kkkkk', 'rs', 'rsrs', 'haha',
  'hahaha', 'ne', 'ta', 'to', 'tao', 'num', 'numa', 'ao', 'aos', 'algo', 'alguem', 'nada', 'tudo',
  'todo', 'toda', 'todos', 'todas', 'outro', 'outra', 'mesmo', 'mesma', 'sobre', 'entre', 'depois',
  'antes', 'sempre', 'nunca', 'vez', 'vezes', 'pode', 'podem', 'seria', 'vai', 'ver', 'vi', 'viu',
  'olha', 'sei', 'sabe', 'acha', 'achei', 'certo', 'bom', 'boa', 'dia', 'noite', 'tarde', 'obrigado',
  'obrigada', 'valeu', 'vlw', 'blz', 'beleza', 'oi', 'ola', 'opa', 'eae', 'salve', 'ok', 'msm', 'q',
  'n', 'p', 'c', 'mt', 'mto', 'td', 'tds', 'aq', 'dps', 'hj', 'oq', 'agr', 'cmg', 'fazendo', 'ficar',
  // en
  'the', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for', 'with', 'is', 'are', 'was',
  'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we',
  'they', 'my', 'your', 'his', 'her', 'our', 'their', 'do', 'does', 'did', 'have', 'has', 'had', 'not',
  'no', 'yes', 'so', 'just', 'like', 'what', 'when', 'where', 'who', 'why', 'how', 'will', 'would',
  'can', 'could', 'should', 'about', 'from', 'up', 'out', 'if', 'then', 'there', 'here', 'lol', 'lmao',
  // redaction placeholders
  'link', 'mencao', 'participante', 'telefone', 'email', 'documento'
]);

function stripAccents(value) {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function normalize(value) {
  return stripAccents(String(value || '').toLowerCase());
}

function tokenize(value) {
  const normalized = normalize(value)
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ');
  return normalized
    .split(/\s+/)
    .map(token => token.replace(/^-+|-+$/g, ''))
    .filter(Boolean);
}

function contentTokens(value) {
  return tokenize(value).filter(token => token.length >= 3 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function bigrams(tokens) {
  const result = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    result.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return result;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a regex that matches any of the given keyword phrases on word
 * boundaries, against already-normalized text.
 */
function buildKeywordRegex(keywords) {
  const parts = keywords
    .map(keyword => normalize(keyword).trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map(keyword => escapeRegExp(keyword).replace(/\s+/g, '\\s+'));
  if (parts.length === 0) return null;
  return new RegExp(`(?:^|[^a-z0-9])(${parts.join('|')})(?=$|[^a-z0-9])`, 'g');
}

function countMatches(regex, normalizedText) {
  if (!regex) return [];
  regex.lastIndex = 0;
  const matches = [];
  let match;
  while ((match = regex.exec(normalizedText)) !== null) {
    matches.push(match[1].replace(/\s+/g, ' '));
    if (match.index === regex.lastIndex) regex.lastIndex++;
  }
  return matches;
}

module.exports = {
  STOPWORDS,
  stripAccents,
  normalize,
  tokenize,
  contentTokens,
  bigrams,
  escapeRegExp,
  buildKeywordRegex,
  countMatches
};
