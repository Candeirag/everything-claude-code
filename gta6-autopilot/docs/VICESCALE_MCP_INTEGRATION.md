# ViceScale MCP — Integração (Fase 1: descoberta)

> Levantamento feito em 2026-11-18 diretamente no servidor MCP `ViceScale` conectado a esta sessão do Claude Code.
> Nada aqui foi inferido do site de marketing: a lista de ferramentas, os parâmetros e os retornos vêm dos schemas reais expostos pelo servidor e de chamadas de teste.

## 1. Conexão e autenticação

| Item | Resultado |
|---|---|
| Servidor localizado | Sim — conector `ViceScale` (prefixo `mcp__ViceScale__*`) |
| Autenticado | Sim — `status` retornou "Conectado ao ViceScale", plano **Vitalício** |
| Redes sociais conectadas | **Nenhuma** ("conecte em /integracoes") |
| Projetos existentes | 1 projeto Scale (draft, 23/09/2026); 0 Templates; 0 Reposts |
| Perfis de template salvos | Nenhum |
| Estilos de texto salvos | Nenhum (padrão: TikTok Sans Bold, sem traçado) |
| Tipo de autenticação | Conector OAuth da conta claude.ai. **Não há API REST pública, chave de API nem endpoint MCP documentado** em vicescale.com (verificado em 18/11/2026). |

### Implicação para produção em nuvem
O servidor só é alcançável hoje **através de uma sessão Claude** que tenha o conector ViceScale. Um backend próprio (Node/Python num servidor) **não consegue chamar a ViceScale diretamente** sem um endpoint MCP + token documentados.

Caminhos possíveis:
1. **Tarefas agendadas do Claude (nuvem)** — uma tarefa agendada que inicia uma sessão nova a cada disparo com o conector ViceScale autorizado. Não depende do computador do usuário. É o caminho viável hoje.
2. **Endpoint MCP direto com token** — pedir ao suporte (contato@vicescale.com) a URL do servidor MCP e um token de serviço. Se fornecido, o `ViceScaleMCPAdapter` passa a falar com ele por HTTP a partir do backend, com o token num secret do provedor de nuvem.
3. Sessão interativa local — **não serve** para operação contínua.

## 2. Ferramentas descobertas (22)

Legenda de risco: 🟢 leitura · 🟡 gera custo/cota ou cria recurso · 🔴 publica externamente (exige confirmação)

### Conta
| Ferramenta | Risco | Parâmetros | Retorno |
|---|---|---|---|
| `status` | 🟢 | — | e-mail, plano, redes conectadas (via Zernio), nº de projetos Scale |

### Descoberta de conteúdo (ViceScrap) — somente Instagram/TikTok de terceiros
| Ferramenta | Risco | Parâmetros | Retorno |
|---|---|---|---|
| `buscar_perfil` | 🟢/🟡 cota ViceScrap | `usuario` (obrig., ≤200), `quantidade` 1–50 (padrão 24) | reels recentes de perfil **público do Instagram** com curtidas, comentários, plays e link |
| `buscar_fotos_perfil` | 🟢/🟡 | `usuario` **ou** `url`; `quantidade` 1–50 | posts de feed (image/carousel/video) |
| `resolver_video` | 🟢 | `url` (Instagram/TikTok) | URL do MP4 real |
| `baixar_video` | 🟡 cota Downloads | `url` | `storagePath` temporário (apagado após render ou 24h) |

### Produção — Templates (único fluxo de vídeo criável via MCP)
| Ferramenta | Risco | Parâmetros | Retorno |
|---|---|---|---|
| `listar_perfis_template` | 🟢 | — | perfis (nome/@handle) salvos |
| `listar_estilos_texto` | 🟢 | — | estilos de texto salvos |
| `sugerir_frases` | 🟡 IA | `tema` (obrig., ≤500), `quantidade` 1–100 | frases curtas estilo tweet |
| `sugerir_headlines` | 🟡 IA | `tema` (obrig.), `modo` `gta`\|`phrases`, `quantidade` 1–100 | hooks para sobrepor em clipe de GTA |
| `criar_post_template` | 🟡 cria projeto | `nome` (obrig.), `videos[]` 1–30 `{storagePath, duracaoSegundos?}` (obrig.), `frases[]` 1–50 ≤280 (obrig. exceto `original`), `estilo` `twitter`\|`meme`\|`original`, `modo` `cartesian`\|`cycle`, `perfilId?`, `estiloTextoId?` | `projectId` |
| `renderizar_post_template` | 🟡 cota Scale/Templates (compartilhada) | `projectId` | render assíncrono disparado |
| `status_post_template` | 🟢 | `projectId` | `draft`/`rendering`/`completed`/`failed` + link do vídeo + variações |
| `listar_projetos_template` | 🟢 | `limite` 1–30 | posts recentes com status e link |

### Produção — Scale
| Ferramenta | Risco | Parâmetros | Retorno |
|---|---|---|---|
| `listar_projetos_scale` | 🟢 | `limite` 1–30 | projetos Scale com status e link |

> **Não existe ferramenta MCP para criar, editar ou renderizar projetos Scale.** O multiplicador Scale e o Editor de clipes só estão disponíveis no painel web.

### ViceRepost (somente imagens)
| Ferramenta | Risco | Parâmetros | Retorno |
|---|---|---|---|
| `criar_repost` | 🟡 | `url` (post de foto/carrossel do Instagram) | `projectId` |
| `traduzir_legenda_repost` | 🟡 IA | `projectId` | legenda PT ativa |
| `reescrever_legenda_repost` | 🟡 IA | `projectId` | legenda reescrita ativa |
| `traduzir_imagem_repost` | 🟡 IA | `projectId` | imagem com texto traduzido |
| `status_repost` | 🟢 | `projectId` | legenda ativa, status, link |
| `listar_reposts` | 🟢 | `limite` 1–30 | reposts recentes |

### Publicação
| Ferramenta | Risco | Parâmetros | Observações |
|---|---|---|---|
| `publicar_template` | 🔴 | `projectId`, `plataforma` `instagram`\|`youtube`\|`facebook`, `legenda` (1–2000) obrigatórios; `agendarPara` `AAAA-MM-DDTHH:mm` + `timezone` IANA; `variationIndex` | **TikTok não suportado via MCP** (exige consentimento próprio do TikTok, só pelo painel /integracoes). Sem `agendarPara` publica **imediatamente**. |
| `publicar_repost` | 🔴 | `projectId`, `plataforma` `instagram`\|`youtube`\|`facebook`; `legenda?`, `agendarPara?`, `timezone?` | Imagem; TikTok não suportado. |

## 3. O que NÃO existe no MCP (lacunas confirmadas)

| Necessidade do projeto | Disponível via MCP? | Alternativa |
|---|---|---|
| Publicar no **TikTok** | ❌ | Painel ViceScale manual, ou TikTok Content Posting API oficial (requer app aprovado) |
| Publicar no YouTube Shorts | ✅ `publicar_template` (`youtube`) | — (falta conectar a conta em /integracoes) |
| Agendamento | ✅ `agendarPara` | — |
| Listar/cancelar/reprogramar agendamentos | ❌ | Controle no banco do Autopilot; cancelamento só no painel |
| **Métricas / analytics** | ❌ | YouTube Data API + YouTube Analytics API; TikTok Display API |
| Tendências TikTok/YouTube | ❌ | YouTube Data API (search/videos), RSS de notícias, Reddit API |
| Busca de perfil TikTok | ❌ (só `resolver_video`/`baixar_video` por link) | — |
| Upload de vídeo próprio | ❌ (só via link IG/TikTok) | Painel web |
| Scale (multiplicador) / Editor de clipes | ❌ | Painel web; ou Templates estilo `original` |
| Cortes com início/fim | ❌ | ffmpeg no backend antes de publicar o clipe num link de origem — ou no painel |
| Legendas automáticas (transcrição) | ❌ | Whisper/serviço de transcrição + ffmpeg |
| Exclusão de conteúdo | ❌ (nenhuma ferramenta destrutiva exposta) | — |
| Status de publicação após agendada | ❌ | Confirmar via API da plataforma |

## 4. Direitos de uso
Todas as fontes de vídeo via MCP são **perfis de terceiros** (Instagram/TikTok). A ferramenta baixar um vídeo **não** concede licença. O Autopilot deve:
- registrar origem, titular e licença de cada material;
- bloquear `baixar_video` → `publicar_*` para materiais sem licença registrada;
- priorizar gameplay próprio ou licenciado (que hoje precisa entrar pelo painel, já que o MCP não aceita upload).

## 5. Operações que exigem confirmação
- `publicar_template`, `publicar_repost`: sempre. Em teste: **nunca** chamar (dry-run no adapter).
- `renderizar_post_template`, `criar_post_template`, `baixar_video`, `sugerir_*`, `*_repost` de IA: consomem cota — controladas por limite diário no adapter.

## 6. Testes não destrutivos executados (18/11/2026)

### Descoberta direta (sessão Claude)
| Chamada | Resultado |
|---|---|
| `status` | OK — conectado, plano Vitalício, 0 redes |
| `listar_projetos_scale(5)` | OK — 1 projeto draft |
| `listar_projetos_template(5)` | OK — vazio |
| `listar_reposts(5)` | OK — vazio |
| `listar_perfis_template` | OK — vazio |
| `listar_estilos_texto` | OK — vazio |

### Ponta a ponta pelo `ViceScaleMCPAdapter` (transporte ponte, servidor real)
| Capacidade | Ferramenta | Resultado |
|---|---|---|
| `account.status` (via `health`) | `status` | enfileirada → executada → `completed`; saúde registrada `ok: true`; e-mail redigido no banco |
| `scale.list` | `listar_projetos_scale` | `completed` |
| `template.listProfiles` | `listar_perfis_template` | `completed` |
| `publish.tiktok` | — | recusada: `CAPABILITY_UNAVAILABLE` com alternativa (fila manual) |
| `publish.video` sem direitos | `publicar_template` | `BLOCKED` (`rights_not_cleared`) — nada enviado |
| `publish.video` com direitos | `publicar_template` | `dry_run` — nada enviado (padrão da Fase 1) |

Ferramentas que consomem cota (`buscar_perfil`, `sugerir_*`, `baixar_video`, `criar_*`, `renderizar_*`) e as de publicação **não** foram chamadas de verdade nesta fase.

## 7. Pré-requisitos do usuário
1. Conectar YouTube (e Instagram, se quiser) em vicescale.com/integracoes.
2. Criar no painel um perfil de template e um estilo de texto para a identidade visual do canal.
3. Para TikTok: decidir entre publicação manual pelo painel ou registrar app na TikTok for Developers.
4. Opcional: pedir ao suporte endpoint MCP + token de serviço para chamadas diretas do backend.

## 8. Como o Autopilot usa a ViceScale (`ViceScaleMCPAdapter`)

Nenhum módulo chama ferramentas MCP diretamente. Tudo passa por
`src/vicescale/adapter.js`, que recebe **capacidades** estáveis
(`src/vicescale/capabilities.js`) e as traduz para as ferramentas reais.

```js
import { createAdapter } from './src/config.js';
const { adapter } = createAdapter();

await adapter.run('copy.suggestHeadlines', { topic: 'fuga da polícia de moto', mode: 'gta', count: 5 },
  { idempotencyKey: 'headlines:opp-123' });

await adapter.run('publish.video', {
  projectId, platform: 'youtube', caption,
  scheduleAt: '2026-12-01T18:00', timezone: 'America/Sao_Paulo',
}, { idempotencyKey: `publish:${clipId}:youtube`, context: { rightsCleared: true } });
```

| Proteção | Comportamento |
|---|---|
| Validação | Args conferidos contra o schema real + regras locais; parâmetro inventado é recusado antes da rede |
| Idempotência | Toda operação não-leitura exige `idempotencyKey`; repetição devolve a operação existente |
| Retentativa | Só leituras com erro transitório (backoff exponencial). Escritas nunca repetem sozinhas — exige `retryFailed: true` |
| Dry-run | Padrão `publish`: publicações são registradas mas não enviadas. `AUTOPILOT_DRY_RUN=off` só após aprovação |
| Direitos de uso | Publicação exige `context.rightsCleared === true` |
| Publicação imediata | Bloqueada sem `agendarPara`, salvo `context.allowImmediate` |
| Emergência | `autopilot emergency-stop on` suspende todas as publicações |
| Cotas | Teto diário interno por balde (`scrap`, `downloads`, `render`, `ai`, `repost`, `publish`) |
| Auditoria | Tabela `audit_log`; segredos e e-mails redigidos (`src/lib/redact.js`) |
| Autenticação | `AuthError` (HTTP 401/403 ou `bridge:fail --auth`) grava `auth_alert` para o painel |
| Disponibilidade | `health` registra cada verificação em `health_checks` |
| Descoberta | `discover` (transporte http) compara `tools/list` com `catalog.json` e alerta mudanças de schema |

### Transportes
| `VICESCALE_TRANSPORT` | Quando usar | Requisitos |
|---|---|---|
| `bridge` (padrão) | Hoje. Uma sessão Claude com o conector ViceScale executa a fila com `/vicescale-worker` | Conector ViceScale autorizado na conta claude.ai |
| `http` | Se a ViceScale fornecer endpoint MCP + token de serviço | `VICESCALE_MCP_URL` e `VICESCALE_MCP_TOKEN` como secrets do servidor (nunca no repositório) |
