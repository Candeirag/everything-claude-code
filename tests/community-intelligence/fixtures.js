'use strict';

/**
 * Synthetic WhatsApp exports for Community Intelligence tests.
 * All names, numbers and conversations are fictional.
 */

const PEOPLE = ['Ana Souza', 'Bruno Lima', 'Carla Dias', 'Diego Rocha', 'Elisa Prado', 'Felipe Nunes',
  'Gabi Torres', 'Hugo Melo', 'Iris Campos', 'João Alves', '+55 11 98888-7777'];

function pad(value) {
  return String(value).padStart(2, '0');
}

/** Android pt-BR line: "dd/mm/yyyy hh:mm - Nome: texto" */
function androidLine(day, month, hour, minute, author, text) {
  const header = `${pad(day)}/${pad(month)}/2026 ${pad(hour)}:${pad(minute)}`;
  return author ? `${header} - ${author}: ${text}` : `${header} - ${text}`;
}

function buildAndroidExport() {
  const lines = [];
  const add = (day, hour, minute, author, text) => lines.push(androidLine(day, 11, hour, minute, author, text));

  // System / noise
  add(1, 9, 0, null, 'As mensagens e as chamadas são protegidas com a criptografia de ponta a ponta.');
  add(1, 9, 1, null, 'Bruno Lima entrou usando o link de convite deste grupo');

  // Previous window (Nov 2-8): price + release-date at moderate volume.
  add(3, 10, 0, PEOPLE[0], 'Quanto vocês acham que vai custar o GTA 6? Preço de 70 dólares?');
  add(3, 10, 4, PEOPLE[1], 'Acho que a edição deluxe vai passar de 400 reais');
  add(3, 10, 9, PEOPLE[2], 'O preço vai ser salgado, certeza');
  add(4, 20, 0, PEOPLE[3], 'Alguém sabe se a data de lançamento continua a mesma?');
  add(4, 20, 3, PEOPLE[4], 'Por enquanto sim, nada oficial sobre adiamento');
  add(5, 18, 0, PEOPLE[5], 'O mapa de Leonida parece enorme');
  add(6, 12, 0, PEOPLE[6], '<Mídia oculta>');
  add(6, 12, 1, PEOPLE[7], 'Mensagem apagada');

  // Current window (Nov 9-15)
  // Trailers: broad participation, curiosity-heavy.
  const trailerTalk = [
    [9, 21, 0, 0, 'Saiu o trailer 3!!! 🔥'],
    [9, 21, 1, 1, 'Vocês repararam no detalhe do reflexo no trailer?'],
    [9, 21, 3, 2, 'Sabia que o trailer tem easter egg do Vice City original?'],
    [9, 21, 5, 3, 'Notei a placa no fundo do trailer, curiosidade demais'],
    [9, 21, 8, 4, 'Trailer insano, mal posso esperar'],
    [10, 9, 0, 5, 'Revi o trailer 10 vezes, percebi um detalhe na praia'],
    [10, 9, 6, 6, 'Esse trailer foi gravado no PS5 base?'],
    [10, 9, 9, 7, 'Acho que o trailer é in-engine sim'],
    [11, 19, 0, 8, 'Alguém sabe quantos segundos tem o trailer novo?'],
    [12, 19, 30, 9, 'O trailer bateu recorde de views de novo'],
    [13, 22, 0, 0, 'Teoria: o trailer mostra a Lucia saindo da prisão'],
    [14, 8, 0, 1, 'Mais um detalhe do trailer: o jacaré na loja de conveniência']
  ];
  for (const [day, hour, minute, who, text] of trailerTalk) add(day, hour, minute, PEOPLE[who], text);

  // Release date: debate with disagreement and back-and-forth.
  const releaseDebate = [
    [11, 14, 0, 2, 'Será que vai ter adiamento de novo? A data de lançamento ainda parece arriscada'],
    [11, 14, 2, 3, 'Discordo, a Rockstar confirmou a data no último balanço'],
    [11, 14, 4, 2, 'Na verdade eles só repetiram a janela, não a data exata'],
    [11, 14, 5, 4, 'Concordo com a Carla, ainda pode ter delay'],
    [11, 14, 7, 5, 'Nada a ver, o lançamento está mantido'],
    [11, 14, 9, 3, 'Exato'],
    [12, 10, 0, 6, 'Quando abre a pré-venda?'],
    [12, 10, 3, 7, 'Pré-venda deve abrir junto com o próximo trailer'],
    [13, 16, 0, 8, 'Vai sair mesmo na data? Alguém tem fonte oficial?']
  ];
  for (const [day, hour, minute, who, text] of releaseDebate) add(day, hour, minute, PEOPLE[who], text);

  // Vehicles: one person flooding the group (dominance must be penalized).
  for (let i = 0; i < 16; i++) {
    add(12, 15, i, PEOPLE[9], `Olha esse carro ${i + 1} que eu acho que vai ter no jogo, supercarro demais`);
  }
  add(12, 16, 0, PEOPLE[0], 'Legal os carros');

  // Emergent term not in the taxonomy: "modo foto", growing from zero.
  const photoMode = [
    [13, 11, 0, 0, 'Será que vai ter modo foto no GTA 6?'],
    [13, 11, 20, 4, 'Modo foto seria perfeito pra criar conteúdo'],
    [14, 12, 0, 6, 'Se tiver modo foto, vou fazer vídeo só disso'],
    [14, 12, 30, 7, 'Modo foto no lançamento ou só depois?'],
    [15, 9, 0, 8, 'O modo foto do RDR2 era ótimo, espero o mesmo']
  ];
  for (const [day, hour, minute, who, text] of photoMode) add(day, hour, minute, PEOPLE[who], text);

  // Rumors with personal data that must be redacted.
  add(14, 18, 0, PEOPLE[10], 'Vazou que vai ter DLC no lançamento, um insider postou. Me chama no 11 97777-6666 ou fulano@example.com');
  add(14, 18, 5, PEOPLE[1], '@5511988887777 isso é fake, boato antigo. Veja https://www.rockstargames.com/newswire e https://chat.whatsapp.com/AbCdEf');
  add(14, 18, 9, PEOPLE[2], 'A Iris tinha falado desse vazamento semana passada');

  // Multi-line message
  add(15, 10, 0, PEOPLE[3], 'Resumo da semana:');
  lines.push('- trailer 3');
  lines.push('- debate da data de lançamento');

  return `${lines.join('\n')}\n`;
}

/** iOS en-US export (12h clock) for parser coverage. */
function buildIosExport() {
  return [
    '‎[11/14/26, 9:05:12 PM] Ana Souza: ‎Messages and calls are end-to-end encrypted.',
    '[11/14/26, 9:06:00 PM] Ana Souza: Did you see the new trailer?',
    '[11/14/26, 9:07:30 PM] Bruno Lima: Yes! The map looks huge',
    'and the weather effects too',
    '[11/14/26, 9:08:00 PM] Carla Dias: ‎image omitted',
    '[11/14/26, 12:15:00 AM] Carla Dias: When is the release date?',
    '[11/15/26, 1:00:00 AM] Diego Rocha: This message was deleted'
  ].join('\n');
}

function buildPrivateChatExport() {
  return [
    androidLine(10, 11, 10, 0, 'Ana Souza', 'Oi, tudo bem? Viu o trailer?'),
    androidLine(10, 11, 10, 5, 'Bruno Lima', 'Vi sim, muito bom')
  ].join('\n');
}

module.exports = { PEOPLE, buildAndroidExport, buildIosExport, buildPrivateChatExport, androidLine };
