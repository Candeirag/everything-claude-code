---
name: community-intelligence
description: Inteligência de comunidade para o GTA 6 Autopilot (módulo 9). Importa exportações autorizadas de um grupo de WhatsApp, agrupa discussões por tema, ranqueia assuntos sem confundir volume com popularidade, detecta tendências emergentes, gera pautas de vídeo para TikTok/YouTube Shorts, envia handoffs ao GTA Scout, Trend Analyst e Growth Manager, e aprende com o desempenho dos vídeos. Privacidade por padrão.
origin: ECC
---

# Community Intelligence (WhatsApp)

Usa as discussões de um grupo de networking como **fonte complementar** de inteligência de mercado e descoberta de pautas para o GTA 6 Autopilot. Nunca é a única fonte de notícias e nunca confirma fatos.

## When to Use

- O administrador do grupo entregou uma nova exportação da conversa (`.txt` ou `.zip`).
- Na rotina semanal de pautas: o que a comunidade está discutindo, o que está crescendo, o que ainda não virou vídeo.
- Quando o GTA Scout, o Trend Analyst ou o Growth Manager precisam do sinal da comunidade.
- Ao registrar vídeos publicados a partir de pautas da comunidade e importar as métricas deles.
- Quando alguém pede opt-out ou a exclusão dos dados importados.

Não use para monitorar pessoas, ler conversas privadas, verificar notícias ou citar mensagens em conteúdo publicado.

## How It Works

### Acesso: somente métodos oficiais e autorizados

Não existe integração direta com o WhatsApp. A Groups API oficial só cobre grupos criados pela própria empresa (até 8 participantes, Official Business Account), então não alcança um grupo de networking que já existe. Automação não oficial é proibida. A entrada é:

1. **Exportação pelo administrador** ("Exportar conversa" → "Sem mídia"): Android `.txt`, iOS `.zip` com `_chat.txt`.
2. **JSON/JSONL neutro** (`{timestamp, author, text}`) vindo de outro pipeline autorizado.

Detalhes e fontes: [references/whatsapp-access-methods.md](references/whatsapp-access-methods.md).

### Pipeline

```
exportação → parser → privacidade → armazenamento mínimo → análise → ranking
     → pautas → handoffs (Scout / Trend Analyst / Growth Manager) → dashboard
vídeos publicados + métricas → aprendizado → potencial dos temas na próxima análise
```

1. **Parser**: formatos Android/iOS, pt-BR/en, relógio de 12h/24h, mensagens com várias linhas. Descarta mensagens de sistema, mídia, apagadas e localização. Do `.zip`, só a transcrição é lida; a mídia nunca é extraída.
2. **Privacidade** (antes de gravar qualquer coisa):
   - autor → pseudônimo HMAC-SHA256 com salt local; nomes nunca vão para o disco;
   - remove do texto telefones, e-mails, CPF/CNPJ, @menções, links de perfil/convite e nomes de participantes citados;
   - recusa conversas com menos de 3 autores, que parecem privadas;
   - exige consentimento registrado e aplica opt-outs e retenção (180 dias por padrão).
3. **Agrupamento**: taxonomia de 16 temas de GTA 6 (multirrótulo) mais **temas emergentes**: termos e bigramas fora da taxonomia, com pelo menos 4 mensagens, 3 autores distintos e pelo menos o dobro do volume da janela anterior. Respostas curtas sem palavra-chave ("concordo", "exato") herdam o tema da conversa com peso 0,5.
4. **Sinais por mensagem**: dúvida, curiosidade, discordância/concordância, empolgação.
5. **Ranking** (janela atual contra a anterior, 7 dias por padrão):

   | Componente | Peso | Como mede |
   |---|---|---|
   | Frequência | 0,15 | log do volume ponderado, relativo ao maior tema |
   | Crescimento | 0,20 | variação suavizada contra a janela anterior, com piso de volume |
   | Diversidade | 0,20 | participantes efetivos (1/Herfindahl) sobre os ativos |
   | Debate | 0,10 | discordância, concordância, perguntas e alternância de autores |
   | Potencial de conteúdo | 0,20 | taxa de dúvidas/curiosidades/empolgação + potencial visual, combinado com o desempenho histórico do tema |
   | Relevância para GTA 6 | 0,15 | relevância da taxonomia; nos emergentes, menção a GTA/Rockstar |

   **Volume não é popularidade:** a frequência pesa só 15%; quando uma pessoa concentra mais de 50% das mensagens de um tema, o score é penalizado; tema sem mensagens na janela fica com score 0; todo tema leva um rótulo de confiança (`alta`/`media`/`baixa`) conforme o tamanho da amostra.
6. **Pautas**: tendências emergentes, oportunidades pouco exploradas e temas de maior score viram sugestões com título, gancho, formato e plataformas. O ângulo segue o sinal dominante (dúvida → resposta, debate → os dois lados, curiosidade → detalhes). Toda pauta sai com `factCheck.required: true`. Temas de rumor são enquadrados como "Rumor ou fato?". Não há pauta duplicada para o mesmo tema por 14 dias.
7. **Oportunidades pouco exploradas**: temas na metade superior do ranking sem vídeo nos últimos 30 dias, ou com índice de desempenho ≥ 1,2 e pouca cobertura.
8. **Aprendizado**: vídeos vinculados a temas/pautas recebem métricas (CSV/JSON exportado do TikTok Studio / YouTube Studio). O índice de desempenho compara cada vídeo com a mediana da plataforma. O histórico por tema e plataforma alimenta o Growth Manager e o componente "potencial" das próximas análises. A correlação de Spearman entre score e desempenho mostra se essa fonte merece mais ou menos peso.

### Comandos

```bash
CI="node skills/community-intelligence/scripts/community-intel.js"

$CI init --consent-confirmed --consent-note "Admin autorizou análise agregada em 2026-11-10; aviso fixado no grupo" \
         --group-label "Networking GTA" --retention-days 180 --handoff-dir ../gta6-autopilot/inbox
$CI import ~/Downloads/export.zip --label "semana 46"
$CI analyze --window-days 7                       # ranking, tendências, pautas, handoffs, dashboard
$CI suggestions list --status enviada
$CI suggestions status sug-a24ce51baa verificada --note "Confirmado no Newswire"
$CI video link --video-id 7311... --platform tiktok --suggestion sug-a24ce51baa --title "..." --published-at 2026-11-16
$CI metrics import tiktok-export.csv              # colunas: video_id, platform, views, likes, comments, shares, saves, avg_watch_pct
$CI opt-out --name "Nome como aparece na exportação"
$CI purge --import imp-20261116120000-a76f --yes  # ou --older-than 90 --yes, ou --all --yes
$CI status
```

Diretório de dados: `--data-dir`, ou `$GTA6_COMMUNITY_DATA_DIR`, ou `./.gta6-autopilot/community-intelligence` (deixe-o fora do git). Para adaptar temas, crie `taxonomy.json` no diretório de dados (veja [examples/taxonomy.example.json](examples/taxonomy.example.json)).

### Saídas

- `dashboard/index.html`: seção **COMMUNITY INTELLIGENCE** com temas mais discutidos, tendências emergentes, novas pautas, oportunidades, histórico de assuntos, pautas convertidas em vídeos, desempenho dos vídeos originados das discussões, e privacidade/importações.
- `dashboard/data.json`: os mesmos dados, para embutir no dashboard geral do Autopilot.
- `handoffs/community-intelligence.{gta-scout,trend-analyst,growth-manager}.json`: contratos em [references/handoff-contracts.md](references/handoff-contracts.md).

### Regras de privacidade (inegociáveis)

1. Não usar mensagens privadas: só grupos, com 3 ou mais autores, exportados pelo administrador.
2. Não publicar mensagens nem informações pessoais: handoffs e dashboard trazem apenas agregados. Nunca cite, parafraseie de perto nem faça print de mensagens em roteiros, legendas ou thumbnails.
3. Não identificar participantes nos conteúdos, nem por apelido ou descrição.
4. Não usar dados pessoais como material de treinamento: tudo leva `trainingUse: prohibited`, e o aprendizado usa só agregados de tema e desempenho.
5. Respeitar o consentimento e as regras do grupo: sem consentimento registrado, a importação é bloqueada. Opt-out remove o participante e o bloqueia daí em diante.
6. Guardar só o necessário: pseudônimo, horário e texto sem dados pessoais; retenção automática; o nome do arquivo não é guardado.
7. Permitir excluir os dados: `purge` por importação, por idade ou tudo (inclusive o salt).

## Examples

### Rotina semanal

```bash
$CI import export-semana-46.zip
$CI analyze
```

Leia o ranking e responda ao time com:

- **Temas mais discutidos**: top 5 com score, participantes efetivos e confiança. Avise quando o volume vier de poucas pessoas.
- **Tendências emergentes**: o que cresceu e entre quantas pessoas.
- **Pautas**: as novas, já enviadas ao Scout, e quais são rumor.
- **Oportunidades**: temas com interesse e sem cobertura.
- **Aprendizado**: o que funcionou no TikTok e o que funcionou no Shorts.

Termine sempre lembrando que nada disso confirma fatos: o Scout valida antes da produção.

### Leitura correta do ranking

| Tema | Msgs | Participantes (efetivos) | Score | Leitura |
|---|---|---|---|---|
| Trailers | 14 | 10 (8,3) | 88 | Interesse amplo e crescente: pauta forte |
| Veículos | 17 | 2 (1,1) | 30 | Uma pessoa dominou a conversa: não é tendência |
| Emergente "modo foto" | 5 | 5 (5,0) | 67 | Novo, distribuído: vale verificar se há algo oficial |

### Ciclo de aprendizado

```bash
$CI video link --video-id tt1 --platform tiktok --suggestion sug-a24ce51baa --published-at 2026-11-16
$CI metrics import metricas.csv
$CI analyze   # o Growth Manager recebe leaderboard por plataforma e recomendações
```
