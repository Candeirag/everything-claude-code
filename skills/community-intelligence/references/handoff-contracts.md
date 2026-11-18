# Contratos de handoff

`analyze` grava três arquivos JSON em `<data-dir>/handoffs/` e, se configurado, também em `--handoff-dir` (a caixa de entrada dos outros agentes do GTA 6 Autopilot):

| Arquivo | Consumidor | Uso |
|---|---|---|
| `community-intelligence.gta-scout.json` | GTA Scout | Verificar pautas contra fontes oficiais |
| `community-intelligence.trend-analyst.json` | Trend Analyst | Cruzar o ranking com sinais externos |
| `community-intelligence.growth-manager.json` | Growth Manager | Calibrar prioridades com o histórico tema → desempenho |

Nenhum handoff contém texto de mensagens, pseudônimos ou dados de participantes. Apenas agregados e rótulos de tema.

## Envelope comum

```json
{
  "schemaVersion": 1,
  "producer": "community-intelligence",
  "consumer": "gta-scout | trend-analyst | growth-manager",
  "generatedAt": "2026-11-16T12:00:00.000Z",
  "sourceType": "complementary-community-signal",
  "disclaimer": "Sinal complementar ... não confirma fatos ... não representa popularidade geral.",
  "privacy": { "containsPersonalData": false, "containsMessageText": false, "trainingUse": "prohibited" },
  "window": { "asOf": "2026-11-15", "days": 7, "start": "2026-11-08", "end": "2026-11-15",
              "messages": 47, "activeParticipants": 11, "previousMessages": 6, "previousParticipants": 6 }
}
```

## Resumo de tema (`topicSummary`)

```json
{
  "topicId": "trailers",
  "label": "Trailers e materiais oficiais",
  "emergent": false,
  "risk": "normal | rumor",
  "score": 88.2,
  "confidence": "alta | media | baixa",
  "components": { "frequency": 0.9, "growth": 1, "diversity": 0.83, "debate": 0.4, "potential": 0.8, "relevance": 1 },
  "dominantSignal": "question | curiosity | disagreement | hype | discussion",
  "growthRatio": 3.67,
  "current": { "messages": 14, "participants": 10, "effectiveParticipants": 8.3, "activeDays": 6, "signals": { "question": 3 } },
  "previous": { "messages": 0, "participants": 0 },
  "keywords": ["trailer", "teaser"]
}
```

## GTA Scout

Campos extras: `request`, `suggestions[]` (status `nova` ou `enviada`), `rumorWatch[]` (topicSummary de temas de rumor), `topTopics[]`.

Sugestão:

```json
{
  "id": "sug-a24ce51baa",
  "createdAt": "2026-11-15",
  "topicId": "trailers",
  "angle": "curiosity",
  "title": "...", "hook": "...", "format": "...",
  "platforms": ["tiktok", "youtube_shorts"],
  "reason": "Tendência emergente",
  "communityScore": 88.2,
  "confidence": "media",
  "evidence": { "messages": 14, "participants": 10, "effectiveParticipants": 8.3, "growthRatio": 3.67, "dominantSignal": "curiosity" },
  "risk": "normal | rumor | nao-verificado",
  "factCheck": { "required": true, "reason": "..." },
  "routedTo": ["gta-scout", "trend-analyst"],
  "status": "enviada"
}
```

**Retorno esperado do Scout:** atualizar o status com
`community-intel.js suggestions status <id> verificada|rejeitada --note "<fonte oficial ou motivo>"`.

## Trend Analyst

Campos extras: `ranking[]` (topicSummary), `emergingTrends[]` (topicIds), `opportunities[]`, `history` (`{ weeks[], series{topicId: number[]} }`, volume semanal ponderado das últimas 8 semanas).

Oportunidade:

```json
{ "topicId": "release-date", "label": "...", "score": 78.2, "reason": "...", "recentVideos": 0, "performanceIndex": null }
```

## Growth Manager

Campos extras:

- `learning.baselines`: mediana de views e engajamento por plataforma.
- `learning.performanceByTopic`: `{ topicId: { videos, performanceIndex, platforms: { tiktok: {...}, youtube_shorts: {...} } } }`.
- `learning.leaderboard`: temas ordenados por índice em cada plataforma.
- `learning.communityVsOther`: índice mediano dos vídeos da comunidade contra os demais.
- `learning.scorePredictsPerformance`: correlação de Spearman entre o score da comunidade no momento da pauta e o desempenho do vídeo (mínimo de 5 pares).
- `topicHistory`: snapshots de score por análise.
- `recommendations[]`: frases acionáveis geradas por regras.

`performanceIndex` = média geométrica de (views ÷ mediana da plataforma) e (engajamento ÷ mediana da plataforma). 1,0 = desempenho típico do canal.
