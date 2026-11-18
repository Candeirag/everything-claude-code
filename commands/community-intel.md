---
description: Community Intelligence do GTA 6 Autopilot. Importa a exportação do grupo de WhatsApp, ranqueia temas, gera pautas e handoffs, e atualiza o dashboard COMMUNITY INTELLIGENCE.
---

# /community-intel

Invoca o agente **community-intelligence** seguindo a skill `community-intelligence`.

## Uso

```
/community-intel                      # analisa os dados já importados
/community-intel <arquivo.txt|.zip>   # importa a exportação e analisa
/community-intel status               # estado, consentimento e importações
/community-intel purge <id>           # exclui uma importação (pede confirmação)
```

## O que faz

1. Confere se o consentimento do administrador está registrado. Se não estiver, para e pergunta.
2. Importa a exportação (`.txt` do Android, `.zip` do iOS ou JSONL neutro), com pseudonimização e remoção de dados pessoais.
3. Roda `analyze`: ranking de temas, tendências emergentes, oportunidades pouco exploradas e novas pautas.
4. Grava os handoffs para GTA Scout, Trend Analyst e Growth Manager.
5. Atualiza `dashboard/index.html` e `dashboard/data.json`.
6. Resume os temas, as tendências, as pautas e o aprendizado por plataforma, e lembra que nada disso confirma fatos.

## CLI

```bash
node skills/community-intelligence/scripts/community-intel.js help
```

## Privacidade

Somente exportações feitas pelo administrador. Nenhuma integração direta ou não oficial com o WhatsApp. Mensagens nunca são citadas nem publicadas, e participantes nunca são identificados. Exclusão: `purge --import <id> --yes`, `purge --older-than <dias> --yes` ou `purge --all --yes`.
