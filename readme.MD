# Kage Bunshin — Bot de Música Multi-Canal

Bot de música para Discord com **arquitetura multi-clone**, capaz de tocar em múltiplos canais de voz simultaneamente dentro do mesmo servidor. Desenvolvido em Node.js com `discord.js` e `discord-player`.

---

## ✨ Recursos

- 🎵 **Reprodução simultânea em vários canais** — até 4 clones independentes
- 🔀 **Distribuição automática de clones** — o gerenciador escolhe um bot livre
- 🎶 **Múltiplas fontes** — YouTube, SoundCloud, Spotify, Apple Music
- 🌐 **Suporte a proxy residencial** — resolve bloqueios de IP em datacenter
- 🎛️ **Painel interativo** — controle via botões (pausar, pular, fila, embaralhar, parar)
- 📊 **Status em tempo real** — mostra quais clones estão livres ou ocupados
- 🔒 **Canal de comandos configurável** — restringe o uso a um canal por servidor
- 🛡️ **Auto-recuperação** — clones que caem são reiniciados automaticamente

---

## 📋 Comandos

| Comando | Descrição |
|---|---|
| `/play <música>` | Reproduz uma faixa (link ou nome) |
| `/skip` | Pula para a próxima faixa |
| `/stop` | Para tudo e desconecta |
| `/pause` | Pausa a reprodução atual |
| `/resume` | Retoma a reprodução pausada |
| `/queue` | Mostra a fila de músicas |
| `/nowplaying` | Mostra a música atual |
| `/volume <0-100>` | Ajusta o volume |
| `/loop <modo>` | Define o modo de repetição (off / track / queue / autoplay) |
| `/shuffle` | Embaralha a fila |
| `/setup <canal>` | Define o canal de comandos (apenas admins) |
| `/unsetup` | Remove a restrição de canal (apenas admins) |
| `/status` | Exibe estado dos clones |
| `/help` | Lista todos os comandos |

---

## 🧠 Como Funciona

O Kage Bunshin usa **arquitetura de múltiplos processos** com o módulo `cluster` do Node.js:

    ┌──────────────────────────────────────┐
    │      PROCESSO PRINCIPAL (MANAGER)    │
    │  - Registra slash commands           │
    │  - Distribui tarefas entre clones    │
    │  - Gerencia estado dos bots          │
    └──────┬───────┬───────┬───────┬───────┘
           │       │       │       │
      ┌────▼──┐ ┌──▼───┐ ┌─▼────┐ ┌▼─────┐
      │ MAIN  │ │WORK_2│ │WORK_3│ │WORK_4│
      │Bot 1  │ │Bot 2 │ │Bot 3 │ │Bot 4 │
      └───────┘ └──────┘ └──────┘ └──────┘

Cada clone roda em um processo separado, mantendo **sua própria conexão de voz**. Quando um usuário executa `/play`, o manager:

1. Verifica se o canal de texto está autorizado
2. Verifica se já existe um clone tocando naquele canal de voz
3. Se sim, adiciona à fila existente
4. Se não, escolhe um clone livre e delega a tarefa

---

## 🛠️ Pré-requisitos

- **Node.js** 20 ou superior
- **FFmpeg** instalado no sistema (`/usr/bin/ffmpeg`)
- **yt-dlp** já baixado na raiz do projeto (o binário precisa estar presente)
- **4 tokens de bot** do Discord Developer Portal

---

## 🚀 Instalação

### 1. Clone o repositório

    git clone https://github.com/seu-usuario/kage-bunshin-bot.git
    cd kage-bunshin-bot

### 2. Instale as dependências

    npm install

### 3. Configure o `.env`

Crie um arquivo `.env` na raiz do projeto:

    BOT_MAIN_TOKEN=token_do_bot_principal
    BOT_2_TOKEN=token_do_bot_2
    BOT_3_TOKEN=token_do_bot_3
    BOT_4_TOKEN=token_do_bot_4

    MAIN_CLIENT_ID=id_da_aplicacao_principal

    PROXY_URL=http://usuario:senha@gw.dataimpulse.com:823

| Variável | Descrição |
|---|---|
| `BOT_MAIN_TOKEN` | Token do bot principal (registra comandos) |
| `BOT_2_TOKEN` até `BOT_4_TOKEN` | Tokens dos bots clones |
| `MAIN_CLIENT_ID` | ID da aplicação principal |
| `PROXY_URL` | URL do proxy residencial (opcional, mas recomendado) |

### 4. Coloque o `yt-dlp` na raiz do projeto

O bot espera o binário `yt-dlp` na raiz do projeto (mesma pasta do `index.js`). Baixe a versão mais recente:

    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
    chmod +x yt-dlp

### 5. Inicie o bot

    npm start

---

## 📁 Estrutura do Projeto

    kage-bunshin-bot/
    ├── index.js                      # Código principal
    ├── package.json
    ├── package-lock.json
    ├── .env                          # Variáveis de ambiente
    ├── yt-dlp                        # Binário do yt-dlp (na raiz do projeto)
    └── runtime-config.json           # Config persistente (gerado em runtime)

---

## 🎵 Fontes Suportadas

| **YouTube** |
| **SoundCloud** |
| **Spotify** |
| **Apple Music** |

---

## 🔐 Configuração no Discord Developer Portal

Para cada um dos 4 bots:

1. Acesse [discord.com/developers/applications](https://discord.com/developers/applications)
2. Crie uma nova aplicação
3. Vá em **Bot** → **Reset Token** → copie o token
4. Ative **Message Content Intent** em **Privileged Gateway Intents**
5. Em **OAuth2 → URL Generator**, marque:
   - Scopes: `bot`, `applications.commands`
   - Permissões: `Administrador` (ou pelo menos `Conectar`, `Falar`, `Enviar Mensagens`, `Usar Comandos de Aplicação`)
6. Convide cada bot para o servidor

---

## 🖥️ Hospedagem

### Discloud

O bot foi otimizado para rodar na Discloud. Recomendações:

- **RAM mínima**: 2000 MB
- **Variáveis de ambiente**: configure no painel (não use `.env` no repositório)
- **APT**: adicione `tools, ffmpeg` na configuração
- **Arquivos necessários**: envie o `yt-dlp` junto no ZIP

### VPS (recomendado para produção)

Para rodar 24/7 sem limitações de RAM, use uma VPS:

- **Recomendado**: 2 GB RAM, 2 vCPU
- **Sistemas**: Ubuntu 22.04+, Debian 12+
- **Instalação**: mesma do item "Instalação" acima

---

## ⚠️ Limitações Conhecidas

### Um bot por canal de voz

A API do Discord impõe que **cada bot mantenha apenas uma conexão de voz ativa por vez**. É por isso que precisamos de múltiplos bots para múltiplos canais. Não é uma limitação do código, é uma regra do Discord.

### YouTube bloqueando IPs de datacenter

O YouTube aplica bloqueios agressivos em IPs de datacenter. As soluções são:

1. **Proxy residencial** (recomendado) — resolve na maioria dos casos
2. **Hospedagem com IP residencial** — a solução definitiva

### Erros HTTP 429

Se aparecer `HTTP Error 429: Too Many Requests`, o IP do proxy foi rate-limited. Soluções:

1. **Trocar a sessão do proxy**
2. **Reduzir a frequência de uso**
3. **Aumentar o plano do proxy**

---

## 🐛 Troubleshooting

### `yt-dlp: error: no such option: --js-runtimes`

Versão antiga do `yt-dlp`. Baixe a versão mais recente:

    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o yt-dlp
    chmod +x yt-dlp

### Bot entra no canal mas não toca

Verifique as permissões `Conectar` e `Falar` no canal de voz. O bot valida essas permissões antes de conectar.

### Músicas do YouTube não tocam mas SoundCloud sim

O YouTube bloqueou o stream. Teste manualmente:

    ./yt-dlp --js-runtimes node \
      --proxy "$PROXY_URL" \
      -f bestaudio --get-url "https://www.youtube.com/watch?v=VIDEO_ID"

Se retornar uma URL, o proxy está OK. Se der erro, o problema é no YouTube ou no proxy.

---

## 📜 Licença

MIT License — use livremente, modifique e distribua.

---

## 🤝 Contribuições

Contribuições são bem-vindas! Abra uma issue ou envie um pull request.

---

## 💡 Créditos

- [discord.js](https://discord.js.org/) — biblioteca principal do Discord
- [discord-player](https://discord-player.js.org/) — framework de reprodução
- [discord-player-youtubedlp](https://www.npmjs.com/package/discord-player-youtubedlp) — extractor com suporte a yt-dlp
- [yt-dlp](https://github.com/yt-dlp/yt-dlp) — downloader universal

---

**Bora encher as calls de música!**