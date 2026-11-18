# Arquitetura — GTA 6 Autopilot

## Visão geral

```
                ┌──────────────────────── Autopilot (Node.js) ─────────────────────────┐
 Fontes         │  Agentes (Fase 2+)                                                  │
 autorizadas ──▶│  Scout → Trend Analyst → Clip Hunter → Video Producer → Copywriter  │
 (RSS, YouTube  │  → Publisher → Performance Analyst → Growth Manager                 │
  Data API...)  │                     │ capacidades estáveis                           │
                │                     ▼                                                │
                │          ViceScaleMCPAdapter  (validação, cotas, idempotência,       │
                │                     │          dry-run, direitos, auditoria)         │
                │          ┌──────────┴───────────┐                                    │
                │   ClaudeBridgeTransport   HttpMcpTransport                            │
                │   (fila "queued")         (se houver endpoint+token)                 │
                └──────────┼──────────────────────┼───────────────────────────────────┘
                           ▼                      ▼
              Sessão Claude com conector    Servidor MCP ViceScale
              ViceScale (/vicescale-worker) ─────────▶ (vicescale.com)
```

## Decisões técnicas

### D1 — Adaptador único + camada de capacidades
Agentes pedem `post.create`, `publish.video` etc. Só `capabilities.js` conhece `criar_post_template` e `publicar_template`. Se a ViceScale renomear uma ferramenta, a mudança fica em um arquivo. Capacidades sem suporte (`publish.tiktok`, `analytics.postMetrics`, `scale.create`…) lançam `CapabilityUnavailableError` com a alternativa, nunca um dado simulado.

### D2 — Catálogo versionado de schemas
`src/vicescale/catalog.json` guarda os schemas reais capturados do servidor. Restrições que só aparecem em texto nas descrições ficam em `localRules`, separadas. `discover` compara com `tools/list` e grava alerta se algo mudou.

### D3 — Ponte via sessão Claude (produção possível hoje)
A ViceScale não documenta endpoint MCP nem token de API: o conector é OAuth da conta claude.ai. Então:
- o backend **enfileira** operações validadas (estado `queued`);
- uma sessão Claude com o conector roda `/vicescale-worker`, que reivindica (`bridge:claim`), chama a ferramenta MCP com os args exatos e devolve o resultado (`bridge:complete`/`bridge:fail`);
- em produção (Fase 5), essa sessão é uma **tarefa agendada do Claude na nuvem**, que inicia uma sessão nova a cada disparo com o conector ViceScale autorizado. Não depende do computador do usuário.

**Limitações explícitas:** cada disparo é uma sessão nova (container efêmero). Por isso o banco precisa ser externo (Postgres) a partir da Fase 5. A latência das operações vira o intervalo entre disparos. Se o conector for desautorizado, o worker reporta `--auth` e o painel mostra o alerta.

### D4 — Transporte HTTP pronto, desligado
`HttpMcpTransport` implementa o protocolo MCP Streamable HTTP (especificação 2025-06-18) sem dependências. Ele só é ativado com `VICESCALE_TRANSPORT=http`, `VICESCALE_MCP_URL` e `VICESCALE_MCP_TOKEN`. Nenhuma URL é presumida. O token vem só do ambiente e nunca é logado.

### D5 — Segurança de publicação por padrão
- Dry-run de publicações ligado por padrão (`AUTOPILOT_DRY_RUN=publish`).
- Publicação exige direitos registrados, agendamento (ou autorização explícita para publicar agora) e chave de idempotência.
- Escritas não são repetidas automaticamente: um erro de rede não prova que o servidor não recebeu a chamada.
- Botão de emergência persistido no banco.

### D6 — Privacidade
Resultados e auditoria passam por `redact`: tokens, `Bearer …` e e-mails são removidos antes de gravar. O e-mail da conta retornado por `status` nunca é persistido.

### D7 — Cut.Pro como plataforma principal, ViceScale como apoio (2026-11-18)
Decisão do dono do projeto após a análise em `docs/CUTPRO_API_INTEGRATION.md`.
- **Cut.Pro**: monitoramento de canais e lives autorizados, cortes com IA (nota 0–10, estratégia própria de GTA 6), legendas PT, render, publicação no **TikTok e YouTube** e agendamento. API REST com chave: o backend chama direto da nuvem, sem ponte.
- **ViceScale**: apoio. Headlines e frases de GTA (`sugerir_headlines`/`sugerir_frases`), templates e variações quando agregarem valor. Continua acessada só pelo `ViceScaleMCPAdapter`.
- Próximo componente: `CutProAdapter`, com as mesmas proteções do adaptador ViceScale (validação, idempotência, dry-run de publicação, direitos de uso, emergência, cotas, auditoria). Também respeita `Retry-After` e os códigos `{ code, extra }`.
- Consequência: a ponte via sessão Claude deixa de ser caminho crítico. Só as funções de apoio da ViceScale dependem dela.

### D8 — Política de direitos para cortes de streamers (2026-11-18)
Decisão do dono do projeto: cortar streamers famosos de GTA 6 (Twitch, Kick, YouTube), sempre creditando o @.

Cada streamer entra num cadastro com o nível de permissão e a evidência:
| Nível | Publicação |
|---|---|
| `explicit_permission` (autorização por escrito) | autônoma |
| `public_clip_policy` (bio/painel libera cortes; link guardado) | autônoma |
| `clip_campaign` (campanha/campeonato de cortes) | autônoma |
| `credit_only` (sem permissão conhecida) | **autônoma, por decisão e risco assumidos pelo dono**, avisado de que crédito não é autorização legal |
| `blocked` (pediu remoção ou proíbe cortes) | nunca |

Travas obrigatórias:
- @ do streamer no vídeo **e** na legenda de todo post;
- primeiro pedido de remoção ou denúncia move o streamer para `blocked` e cancela os posts agendados dele;
- cada corte leva título e contexto próprios (valor editorial; também pesa para monetização).

O `context.rightsCleared` dos adaptadores passa a vir desse cadastro (Fase 2).

## Estado por fase

| Fase | Status | Critério |
|---|---|---|
| 1 — Integração | ✅ Concluída | Conexão funcional testada ponta a ponta e documentação completa |
| 1b — Integração Cut.Pro | ✅ Concluída | `CutProAdapter` testado contra a API real (leituras); falta conectar TikTok/YouTube na Cut.Pro |
| 2 — Produção | ⏳ | Um conteúdo autorizado percorre o pipeline até ficar pronto para publicar |
| 3 — Publicação | ⏳ | Publicação real confirmada (exige YouTube conectado e autorização do dono) |
| 4 — Inteligência | ⏳ | Métricas reais (YouTube Analytics API) ajustando a estratégia |
| 5 — Operação autônoma | ⏳ | Postgres + tarefa agendada na nuvem + painel + alertas |

## Pendências para a Fase 2
- Modelo de dados de oportunidades, clipes, direitos de uso e status do pipeline (12 estados pedidos).
- Fontes autorizadas do Scout (RSS de notícias, YouTube Data API: exige chave de API).
- Fila de produção sobre a tabela `operations` + máquina de estados por item.
- Identidade visual: criar perfil de template e estilo de texto no painel ViceScale (o MCP só lista, não cria).
