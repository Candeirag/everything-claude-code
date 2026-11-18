# Auditoria inicial — GTA 6 Autopilot

Data: 2026-11-18

## Código existente
Não existia código do GTA 6 Autopilot. Nenhum repositório da conta GitHub tem esse nome, e o dono do projeto confirmou que o projeto começa do zero. Por isso não houve nada a preservar ou migrar.

O projeto foi criado em `gta6-autopilot/`, dentro do repositório `everything-claude-code`, porque esta sessão só tem permissão de push nele. Ele é autocontido (nenhum import de fora da pasta) e pode ser movido para um repositório próprio sem alterações.

## Aproveitado do ambiente
| Item | Uso |
|---|---|
| Conector MCP ViceScale (já autenticado na conta claude.ai) | Toda produção/publicação suportada |
| Tarefas agendadas do Claude na nuvem | Executor da ponte em produção (Fase 5), sem depender do computador do usuário |
| Padrões do `everything-claude-code` (comandos `.claude/commands`, testes em Node puro) | Comando `/vicescale-worker`, suíte `node:test` |

## Escolhas de stack
| Decisão | Motivo |
|---|---|
| Node.js ≥ 22.5, ESM, **zero dependências** | Mesmo runtime do repositório hospedeiro; nada a instalar, superfície de ataque mínima, custo zero |
| `node:sqlite` na Fase 1 | Persistência real sem serviço externo. Interface pensada para trocar por Postgres (Supabase, plano gratuito) na Fase 5 |
| `node:test` | Sem framework de testes para manter |

## Riscos identificados
1. **TikTok não é publicável via MCP.** Decisão do dono: fila manual (o sistema prepara, a pessoa publica pelo painel).
2. **Sem métricas via MCP.** Analytics (Fase 4) depende das APIs oficiais do YouTube (OAuth do canal).
3. **Nenhuma rede conectada na ViceScale.** A Fase 3 exige conectar o YouTube em vicescale.com/integracoes.
4. **Fontes de vídeo do MCP são perfis de terceiros.** Isso exige controle rígido de direitos de uso (o adaptador bloqueia publicação sem `rightsCleared`).
5. **Não há upload de vídeo próprio via MCP.** Gameplay próprio ou licenciado precisa entrar pelo painel ou por link público.
6. **Sem endpoint MCP documentado.** O backend não fala diretamente com a ViceScale; usa a ponte via sessão Claude.
7. **Cotas reais do plano "Vitalício" são desconhecidas.** Há tetos internos configuráveis.
