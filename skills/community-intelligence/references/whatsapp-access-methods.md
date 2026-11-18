# Métodos de acesso ao WhatsApp: o que é oficial e autorizado

Verificado em 18/11/2026 na documentação da Meta. Revise antes de mudar a estratégia de ingestão: a plataforma muda com frequência.

## Resumo da decisão

O Community Intelligence **não tem integração direta com o WhatsApp**. A fonte principal é o **arquivo exportado pelo administrador do grupo** ("Exportar conversa" → "Sem mídia"), importado periodicamente. Um formato JSON/JSONL neutro também é aceito, para o caso de existir no futuro outro pipeline autorizado.

## Opções avaliadas

| Método | Oficial? | Funciona para um grupo de networking que já existe? | Decisão |
|---|---|---|---|
| WhatsApp Business Platform (Cloud API), **Groups API** | Sim | **Não.** Só cobre grupos criados pela própria empresa via API, com até **8 participantes**, entrada apenas por link de convite, e exige Official Business Account (OBA). Não está disponível para números do WhatsApp Business app. | Não usar para este caso |
| Cloud API, mensagens 1:1 (webhooks) | Sim | Não se aplica: são conversas privadas com a empresa, e o módulo não deve usar mensagens privadas. | Fora do escopo |
| App WhatsApp / WhatsApp Business app | Sim (app) | Não há API para ler grupos. | — |
| Bibliotecas não oficiais (WhatsApp Web automatizado, clientes de protocolo reverso) | **Não** | Tecnicamente leem grupos, mas violam os Termos de Serviço, arriscam banir o número e capturam dados sem controle do grupo. | **Proibido** |
| **Exportação de conversa pelo administrador** | Sim (recurso nativo do app) | **Sim.** É gerada por quem tem acesso legítimo, sem mídia, e entregue ao operador de forma consciente. | **Adotado** |

Fontes:

- Meta for Developers, Groups API: <https://developers.facebook.com/documentation/business-messaging/whatsapp/groups>. "Max group participants: 8"; "To qualify for groups features, your business must be an Official Business Account (OBA)"; "Groups are an invite-only experience where participants join using a group invite link you send them"; "Groups are not available for WhatsApp Business app phone numbers".

## Como o administrador exporta

- **Android:** abrir o grupo → ⋮ → Mais → Exportar conversa → **Sem mídia**. Gera um `.txt`.
- **iOS:** abrir o grupo → nome do grupo → Exportar conversa → **Sem mídia**. Gera um `.zip` com `_chat.txt`.

Recomendações:

- Exporte sempre do **mesmo aparelho/administrador**. Os nomes no arquivo vêm da agenda de quem exportou, e os pseudônimos dependem desses nomes. O opt-out também.
- Exportações periódicas podem se sobrepor: mensagens duplicadas são descartadas automaticamente.
- O nome do arquivo (que costuma conter o nome do grupo) não é armazenado. Use `--label` se quiser um rótulo.

## Pré-requisitos de consentimento

Antes do primeiro `import`:

1. O administrador autoriza a análise agregada de tendências.
2. As regras do grupo permitem esse uso, ou os membros foram avisados. Um aviso fixado no grupo é o mínimo recomendado.
3. Existe um canal para pedir opt-out (`opt-out --name`) e exclusão (`purge`).
4. O operador registra isso com `init --consent-confirmed --consent-note "..."`. A nota descreve o termo, sem dados pessoais.

## Se o cenário mudar

Se a Meta passar a permitir leitura de grupos existentes por API oficial, ou se o grupo for recriado como grupo da empresa dentro dos limites da Groups API, os eventos recebidos podem ser convertidos para o formato JSONL neutro (`{ "timestamp", "author", "text" }`) e importados pelo mesmo pipeline, com a mesma camada de privacidade.
