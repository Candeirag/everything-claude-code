// Transporte "ponte Claude".
//
// Hoje a ViceScale só é alcançável por um conector MCP autenticado numa sessão
// Claude (não há endpoint + token documentados). Neste modo o adaptador NÃO
// chama a rede: grava a operação validada como "queued". Uma sessão Claude
// (interativa ou tarefa agendada na nuvem) roda o comando
// `.claude/commands/vicescale-worker.md`, que:
//   1. `autopilot bridge:claim`       -> recebe a próxima operação (tool + args)
//   2. chama a ferramenta MCP mcp__ViceScale__<tool> com exatamente esses args
//   3. `autopilot bridge:complete`    -> devolve o resultado ao adaptador
// Assim toda chamada continua passando pelo adaptador (validação, cotas,
// idempotência, dry-run, auditoria), mesmo sem acesso direto à rede.

export class ClaudeBridgeTransport {
  kind = 'bridge';
  deferred = true;

  async listTools() {
    return null; // a descoberta acontece dentro da sessão Claude (ver docs/VICESCALE_MCP_INTEGRATION.md)
  }

  async callTool() {
    throw new Error('ClaudeBridgeTransport é diferido: o adaptador enfileira a operação em vez de chamar callTool.');
  }
}
