# GTA 6 Autopilot

Operação autônoma de conteúdo de GTA 6 (TikTok e YouTube Shorts, em português) sobre a [ViceScale](https://vicescale.com), integrada via MCP.

**Status: Fase 1 (integração ViceScale) concluída.** Ver [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Requisitos
- Node.js ≥ 22.5 (sem dependências npm)
- Conector ViceScale autorizado na conta claude.ai (para o transporte `bridge`)

## Uso rápido
```bash
npm test                                   # 24 testes
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

## Documentação
- [docs/AUDIT.md](docs/AUDIT.md): auditoria inicial e riscos
- [docs/VICESCALE_MCP_INTEGRATION.md](docs/VICESCALE_MCP_INTEGRATION.md): ferramentas reais, limitações e testes
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): decisões técnicas e plano das fases

## Estrutura
```
bin/autopilot.js                 CLI operacional
src/vicescale/adapter.js         ViceScaleMCPAdapter (ponto único de acesso)
src/vicescale/capabilities.js    capacidades estáveis ↔ ferramentas MCP
src/vicescale/catalog.json       schemas reais descobertos
src/vicescale/transports/        bridge (sessão Claude) e http (MCP Streamable HTTP)
src/store/sqlite-store.js        operações, auditoria, saúde, cotas, configurações
.claude/commands/vicescale-worker.md   executor da ponte
tests/                           node:test
```
