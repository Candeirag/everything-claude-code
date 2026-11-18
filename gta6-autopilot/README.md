# GTA 6 Autopilot

Operação autônoma de conteúdo de GTA 6 (TikTok e YouTube Shorts, em português). [Cut.Pro](https://cut.pro) faz cortes e publicação via API; a [ViceScale](https://vicescale.com), via MCP, apoia com headlines e templates.

**Status: Fase 1 concluída (ViceScale); Fase 1b (Cut.Pro) com código pronto, aguardando chave válida.** Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos
- Node.js ≥ 22.5 (sem dependências npm)
- Conector ViceScale autorizado na conta claude.ai (para o transporte `bridge`)

## Uso rápido
```bash
npm test                                   # 37 testes
node --no-warnings bin/autopilot.js status # saúde, cotas, alertas
node --no-warnings bin/autopilot.js capabilities
node --no-warnings bin/autopilot.js health # enfileira verificação da conta
```
Numa sessão Claude Code aberta nesta pasta, rode `/vicescale-worker` para executar a fila contra a ViceScale.

## Configuração (variáveis de ambiente)
| Variável | Padrão | Descrição |
|---|---|---|
| `VICESCALE_TRANSPORT` | `bridge` | `bridge` (sessão Claude) ou `http` (endpoint direto) |
| `VICESCALE_MCP_URL` | — | Só para `http`; fornecida pela ViceScale |
| `VICESCALE_MCP_TOKEN` | — | Só para `http`; **secret**, nunca no repositório |
| `AUTOPILOT_DB` | `data/autopilot.db` | Banco SQLite |
| `AUTOPILOT_DRY_RUN` | `publish` | `publish`, `writes` ou `off` |
| `AUTOPILOT_QUOTAS_JSON` | ver `DEFAULT_QUOTAS` | Tetos diários internos, ex. `{"render":10}` |
| `AUTOPILOT_TIMEZONE` | `America/Sao_Paulo` | Fuso dos agendamentos |
| `CUTPRO_API_KEY` | — | **Secret.** Chave da API Cut.Pro (header `X-Api-Key`) |
| `CUTPRO_WORKSPACE_ID` | — | Só para chave com vários workspaces |
| `CUTPRO_QUOTAS_JSON` | ver `DEFAULT_CUTPRO_QUOTAS` | Tetos diários internos do Cut.Pro |

## Documentação
- [docs/AUDIT.md](docs/AUDIT.md): auditoria inicial e riscos
- [docs/VICESCALE_MCP_INTEGRATION.md](docs/VICESCALE_MCP_INTEGRATION.md): ferramentas reais, limitações e testes
- [docs/CUTPRO_API_INTEGRATION.md](docs/CUTPRO_API_INTEGRATION.md): Cut.Pro, plataforma principal de cortes e publicação
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): decisões técnicas e plano das fases

## Estrutura
```
bin/autopilot.js                 CLI operacional
src/core/guarded-adapter.js      núcleo de proteções comum aos adaptadores
src/cutpro/adapter.js            CutProAdapter (cortes, render, publicação)
src/cutpro/catalog.json          50 operações geradas do openapi.json oficial
scripts/sync-cutpro-catalog.js   regenera o catálogo Cut.Pro
src/vicescale/adapter.js         ViceScaleMCPAdapter (apoio: headlines, templates)
src/vicescale/capabilities.js    capacidades estáveis ↔ ferramentas MCP
src/vicescale/catalog.json       schemas reais descobertos
src/vicescale/transports/        bridge (sessão Claude) e http (MCP Streamable HTTP)
src/store/sqlite-store.js        operações, auditoria, saúde, cotas, configurações
.claude/commands/vicescale-worker.md   executor da ponte
tests/                           node:test
```
