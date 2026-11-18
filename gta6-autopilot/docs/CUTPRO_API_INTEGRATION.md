# Cut.Pro — Análise da API (ferramenta principal de cortes e publicação)

> Levantamento feito em 2026-11-18 a partir da documentação oficial (cut.pro/docs: clipping, publishing, monitoring, rendering, uploads, rate-limits, mcp).
> O contrato `https://api.cut.pro/api/v1/openapi.json` é a fonte da verdade. Ele ainda **não** foi lido porque este container não alcança `api.cut.pro` (proxy recusou). Antes de implementar cada rota, conferir parâmetros e enums no contrato.

## Decisão
**Cut.Pro é a plataforma principal** (cortes, render, publicação incluindo TikTok). **ViceScale vira apoio** (headlines de GTA, templates e variações).

Motivo central: a Cut.Pro tem **API REST com chave de API** (`X-Api-Key`). O backend pode chamá-la direto da nuvem, sem a ponte via sessão Claude que a ViceScale exige.

## Autenticação
| Caminho | Uso no Autopilot | Autenticação |
|---|---|---|
| API REST `https://api.cut.pro/api/v1` | **Produção** (backend na nuvem) | Header `X-Api-Key`. Chave gerada no painel. Com vários workspaces, também `CUTPRO_WORKSPACE_ID` |
| MCP local `npx @cutpro/mcp` | Sessões Claude Code (exploração e testes manuais) | Mesma chave em `CUTPRO_API_KEY` |
| MCP remoto `https://mcp.cut.pro` | Claude.ai e ChatGPT | OAuth |

A chave dá acesso aos créditos **e às contas sociais conectadas**. Fica só em secret do ambiente, nunca no código, em logs ou no chat.

## Fluxo do Autopilot sobre a Cut.Pro
```
POST /videos/info            análise grátis (10/min): título, duração, custo em créditos
POST /videos/{id}/submissions  cobra créditos; source_language "pt", strategy_id, template_id, timeframe
GET  .../submissions/{id}      queued → downloading → transcribing → video_analysis → analyzing → finalizing → completed|failed
GET  .../clips?min_rating=7&sort=rating&order=desc   clipes com rating 0–10, start/end, title, edit_id
POST .../clips/{clipId}/render  (ou já publicar: o post renderiza o que falta)
POST /posts                    TikTok + YouTube num só post, scheduled_at ISO 8601
GET  /posts/{id}               itens pending → rendering → publishing → completed|failed (published_url)
```

## Mapeamento para os agentes
| Agente | Recurso Cut.Pro | Observações |
|---|---|---|
| Scout | `POST /monitors` (`type: video` ou `live`), `GET /monitors/search`, `GET /monitors/discover` | Monitora canais do YouTube, Twitch e Kick de criadores **autorizados** e clipa vídeos novos ou lives automaticamente |
| Clip Hunter | Submissões + **estratégia** (`POST /strategies`: `clip_focus`, `title_style`, `clip_min_length`, `clip_max_length`) | Estratégia GTA 6: "perseguições, descobertas, momentos engraçados, comparações GTA 5×6…", 20–60 s. Criar estratégia exige plano com estratégias personalizadas |
| Clip Hunter (nota) | `rating` 0–10 por clipe | Entra no nosso score 0–100 (retenção/compartilhamento), sem ser a nota final |
| Video Producer | `template_id` na submissão/monitor, `POST .../render`, `GET /renders/limits` | Identidade visual = template salvo na Cut.Pro. Vertical, legendas PT |
| Copywriter | `POST .../title/suggest` (grátis, 60/h), `POST /posts/description` (0–1 crédito, campos prontos por rede) | Complementa as headlines de GTA da ViceScale |
| Publisher | `GET /connections`, `GET /connections/link?platform=tiktok`, `POST /posts`, `GET /posts/usage`, `GET /posts/best-time`, `PATCH`/`reschedule`/`retry`/`DELETE` | **TikTok suportado** (`title`, `privacyLevel` obrigatórios; `isAigc`). YouTube exige `title`, `categoryId` (Games = 20), `privacyStatus` |
| Performance Analyst | ⚠️ **Não confirmado.** O site anuncia "visualizações e engajamento de cada post", mas nenhuma rota de métricas aparece nas páginas lidas. `GET /connections` traz "números da audiência" | Verificar no `openapi.json`. Plano B: YouTube Analytics API e TikTok Display API |
| Growth Manager | `POST .../feedback` (`up`/`down`) | Ensina a IA de cortes; `down` em clipe nota ≤ 5 pode devolver créditos |

Envio de corte próprio (gameplay próprio ou editado fora): `POST /videos/upload` → PUT → `POST /videos/upload/complete`. Com `"destination": "editor"`, o MP4 entra pronto para postar, sem cobrança.

## Proteções que a própria API oferece
| Recurso | Uso |
|---|---|
| `DUPLICATE_POST` | Pedido idêntico repetido logo após o primeiro é recusado (o Autopilot mantém a própria chave de idempotência também) |
| `DAILY_LIMIT_EXCEEDED` + `GET /posts/usage` | Respeitar o limite de posts por conta e por dia do plano |
| `409 VIDEO_ALREADY_PROCESSING`, `RENDER_ALREADY_IN_PROGRESS` | Anti-duplicidade de processamento |
| `DELETE` de submissão em processamento | Cancela e devolve créditos |
| Erros `{ code, extra }`, `Retry-After` em 429/503 | Retentativa controlada |

`DELETE /posts/{id}/items/{itemId}` num item publicado **apaga o vídeo da rede**: operação destrutiva, bloqueada no adaptador sem confirmação explícita.

## Limites
- 600 requisições/min por chave. `POST /videos/info` e `POST /monitors`: 10/min. `title/suggest`: 60/h.
- Concorrência: `TOO_MANY_PENDING_CLIPS`, `BATCH_ALREADY_RUNNING`, renders simultâneos conforme o plano.
- `VIDEO_TOO_LONG` conforme o plano. `422 SHORTS_NOT_SUPPORTED`: não clipa Shorts. `LIVE_STREAM`: live vai por monitor, não por link.
- Retenção: submissões expiram (`410 SUBMISSION_EXPIRED`), MP4 some após `render_expiry_hours`. O `edit_id` nunca expira (dá para renderizar de novo).
- Links de download assinados duram 1 hora: nunca guardar, pedir de novo.

## Custos (site, 18/11/2026)
| Plano | Preço | Créditos (1 crédito = 1 min de vídeo clipado) | Contas/rede | Posts/dia/conta |
|---|---|---|---|---|
| Grátis | US$ 0 | 15 | — | — (marca d'água) |
| Básico | US$ 9,90 | 100 | 1 | 3 |
| Plus | US$ 19,90 | 1.000 | 5 | 9 |
| Pro | US$ 29,90 | 2.500 | 15 | 15 |

Para 8 vídeos/dia (4 por rede, abaixo do limite de 9 do Plus), o **Plus** deve bastar se a análise ficar em torno de ~33 min de vídeo bruto por dia. O Básico **não** serve: 3 posts/dia por conta.

## Direitos de uso
A Cut.Pro corta qualquer link público, mas isso não dá direito de uso. A API até recusa alguns vídeos com `COPYRIGHT_BLOCKED`, o que **não** equivale a autorização. O Autopilot só envia para submissão vídeos e canais com licença registrada (mesma regra `rightsCleared` do adaptador ViceScale).

## Pendências para começar a integração
1. Ler o `openapi.json`. Exige liberar `api.cut.pro` na rede do ambiente, ou ler via ferramenta externa.
2. Conta Cut.Pro e chave de API (plano grátis basta para testar), salva como secret.
3. Conectar TikTok e YouTube **na Cut.Pro** (`GET /connections/link`).
4. Confirmar no contrato se existe rota de métricas por post.
