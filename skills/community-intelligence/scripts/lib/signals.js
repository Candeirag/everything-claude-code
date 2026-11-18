'use strict';

/**
 * Per-message conversational signals (pt-BR + en), computed on normalized text.
 */

const { buildKeywordRegex, countMatches, normalize } = require('./text');

const QUESTION_START = /^(alguem (sabe|viu|tem|ja)|como|quando|qual|quais|quanto|quantos|onde|por que|porque|pq|sera que|vale a pena|tem como|e se|da pra|da para|voces acham|vcs acham|o que|oq|does|do you|is it|is there|are|how|when|what|why|which|anyone|can|will)\b/;

const CURIOSITY = buildKeywordRegex([
  'sabia que', 'sabiam que', 'voce sabia', 'vcs sabiam', 'voces sabiam', 'curiosidade', 'curioso', 'interessante',
  'reparei', 'repararam', 'notei', 'notaram', 'percebi', 'perceberam', 'detalhe', 'detalhes', 'easter egg',
  'did you know', 'fun fact', 'noticed', 'olha isso', 'olhem isso'
]);

const DISAGREEMENT = buildKeywordRegex([
  'discordo', 'nao concordo', 'nada a ver', 'mentira', 'duvido', 'errado', 'exagero', 'viagem', 'forcado',
  'na verdade', 'pelo contrario', 'so que nao', 'que nada', 'nem a pau', 'nao e bem assim', 'impossivel',
  'i disagree', 'wrong', 'nah', 'not true', 'no way', 'cap'
]);

const AGREEMENT = buildKeywordRegex([
  'concordo', 'verdade', 'exato', 'exatamente', 'isso mesmo', 'com certeza', 'faz sentido', 'pois e',
  'agreed', 'true', 'facts', 'same'
]);

const HYPE = buildKeywordRegex([
  'hype', 'hypado', 'ansioso', 'ansiosa', 'ansiedade', 'incrivel', 'absurdo', 'insano', 'surreal', 'brabo',
  'braba', 'lindo', 'perfeito', 'sensacional', 'muito foda', 'mal posso esperar', 'hyped', 'insane', 'amazing',
  'cant wait'
]);

const HYPE_EMOJI = /[\u{1F525}\u{1F631}\u{1F92F}\u{1F60D}\u{1F680}\u{1F633}]/u;

function computeSignals(text) {
  const normalized = normalize(text).trim();
  const words = normalized.split(/\s+/).filter(Boolean).length;
  return {
    question: normalized.includes('?') || QUESTION_START.test(normalized),
    curiosity: countMatches(CURIOSITY, normalized).length > 0,
    disagreement: countMatches(DISAGREEMENT, normalized).length > 0,
    agreement: countMatches(AGREEMENT, normalized).length > 0,
    hype: countMatches(HYPE, normalized).length > 0 || HYPE_EMOJI.test(text),
    words
  };
}

module.exports = { computeSignals };
