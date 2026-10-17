# Kage Bunshin — Bot de Música Multi-Canal

Bot de música para Discord com **arquitetura multi-clone**, capaz de tocar em múltiplos canais de voz simultaneamente dentro do mesmo servidor. Desenvolvido em Node.js utilizando `discord.js`, `shoukaku` e conectado a um ecossistema avançado do **Lavalink** com proteção anti-bloqueio.

---

## ✨ Recursos

- 🎵 **Reprodução simultânea em vários canais** — até 4 clones independentes (Workers).
- 🔀 **Distribuição automática de clones** — o gestor principal escolhe e aloca um bot livre.
- 🎶 **Motor de Áudio Independente** — servidor Lavalink apartado utilizando o plugin de YouTube mais recente.
- 🛡️ **Defesas Anti-Bloqueio (YouTube)** — rotatividade de poTokens gerados via API, Remote Cipher, OAuth2 (YouTube TV) e tráfego através de Proxies Residenciais.
- 🎛️ **Painel Interativo Premium** — controlo dinâmico com botões em Emoji e barra de progresso em tempo real que atualiza a cada 10 segundos sem exceder o Rate Limit.
- ⭐ **Sistema de Favoritos** — guarde as suas músicas preferidas na conta do Discord.
- 🔒 **Restrição de Canais** — Administradores podem definir um canal de texto exclusivo para comandos.

---

## 🧠 A Arquitetura do Sistema

Para que este bot alcance resiliência máxima, ele não funciona sozinho. É constituído por **4 Aplicações conectadas**:

1. **Bot Discord (Node.js)**: Os Clones Kage Bunshin que gerem mensagens, filas e comandos no servidor.
2. **Servidor Lavalink (Java)**: O motor pesado que processa o áudio, lida com conexões HTTP e transmite som para as chamadas de voz.
3. **poToken Generator (Vercel)**: Uma API rotativa em Puppeteer/Playwright que resolve os desafios de prova de origem do YouTube.
4. **Remote Cipher API**: Um serviço de apoio ao Lavalink que lida com as constantes atualizações de assinatura do JavaScript do YouTube.

---

## 📋 Comandos

| Comando | Descrição |
|---|---|
| `/play <query>` | Adiciona uma música/playlist e gera o painel interativo. |
| `/skip` | Pula para a próxima música. |
| `/stop` | Limpa a fila e desliga o clone da chamada. |
| `/pause` | Pausa a reprodução. |
| `/resume` | Retoma a reprodução pausada. |
| `/queue` | Mostra as músicas que estão na fila. |
| `/nowplaying` | Mostra os detalhes da faixa a tocar. |
| `/painel` | Abre o painel interativo de música. |
| `/volume <0-100>` | Ajusta o volume global do clone atual. |
| `/setup <canal>` | **[Apenas Administrador]** Bloqueia os comandos para um único canal. |
| `/unsetup` | **[Apenas Administrador]** Remove o bloqueio de canais. |
| `/status` | Exibe o status de todos os 4 clones Kage Bunshin. |

---

## 📁 Estrutura do Projeto

O projeto é dividido entre os ficheiros do bot em Node.js e os ficheiros de configuração do servidor Lavalink (alojado na Discloud).

```text
kage-bunshin-bot/
├── index.js                # Código principal do cluster e bots
├── package.json
├── .env                    # Tokens do Discord e palavra-passe Lavalink
├── runtime-config.json     # Ficheiro gerado em runtime (canais setup)
├── favorites.json          # Ficheiro gerado em runtime (músicas favoritas)
└── lavalink.jar/           # Diretório do servidor de áudio
    ├── application.yml     # Configurações do Lavalink (Proxy, YouTube, Plugins)
    ├── discloud.config     # Parâmetros de alojamento do Lavalink
    └── lavalink.jar        # Binário do servidor Lavalink
```

---

## 🛠️ Guia de Configuração e Deploy

### Passo 1: Configurar APIs Externas de Proteção
Para o Lavalink não sofrer erros `429 Too Many Requests` ou restrições do YouTube, precisas criar pontes auxiliares:

*   **Gerador de poToken:** Faz o deploy no Vercel do repositório [Nex-Devz/potoken-generator](https://github.com/Nex-Devz/potoken-generator). Ele te dará uma URL do tipo `https://seu-potoken-app.vercel.app/token`.
*   **Decodificador de Cipher:** Podes utilizar a URL pública `https://cipher.kikkia.dev/` (ou realizar deploy próprio em [kikkia/yt-cipher](https://github.com/kikkia/yt-cipher)).

### Passo 2: Autenticação via Conta do YouTube (OAuth2 / YouTube TV)
O YouTube exige login para reproduzir vídeos com restrição de idade. O Lavalink simula o login de uma Smart TV utilizando a tua conta Google.

**Como gerar o teu Refresh Token (O código `1//...`):**

1. No teu ficheiro `application.yml` do Lavalink, deixa a configuração do OAuth temporariamente assim para forçar um novo login:
   ```yaml
   plugins:
     youtube:
       oauth:
         enabled: true
         refreshToken: "" # Deixa vazio na primeira vez
         skipInitialization: false # Tem de estar false para pedir o login
   ```
2. Inicia o teu servidor Lavalink e observa os logs do terminal.
3. Ele vai exibir uma mensagem parecida com esta:
   > `Please go to https://www.google.com/device and enter code: ABCD-EFGH`
4. Abre o link `https://www.google.com/device` no teu navegador e insere o código fornecido.
5. Faz login com uma conta do Google *(Dica: Usa uma conta secundária com data de nascimento configurada para +18 anos)*.
6. Permite o acesso. O Lavalink fará a autenticação com sucesso e vai imprimir no terminal o teu **Refresh Token**:
   > `Refresh token successfully generated: 1//05onHC8z...`

Guarda esse token, irás usá-lo no próximo passo.

### Passo 3: O Servidor Lavalink
O Lavalink precisa de estar hospedado e a rodar na mesma rede que o bot (ou estar acessível externamente). Se fores utilizar a Discloud, a estrutura do diretório deve conter o ficheiro `discloud.config`:

```ini
NAME=LavalinkServer
TYPE=site
MAIN=Lavalink.jar
RAM=512
VERSION=latest
AUTORESTART=true
ID=SEU ID DE SUBDOMINIO
```

Cria o ficheiro **`application.yml`** (Ajusta as variáveis com os teus dados de Proxy, poToken e o Refresh Token gerado no Passo 2):

```yaml
server:
  port: ${PORT:8080}
  address: 0.0.0.0

lavalink:
  plugins:
    # Usa o snapshot que aceita proxies, tokens oauth e potoken remoto
    - dependency: "dev.lavalink.youtube:youtube-plugin:f45bbb7aebfcbc1c553769e04af6cd43afa8b7c3"
      snapshot: true
  server:
    password: "coloque_uma_senha_forte"
    sources:
      youtube: false # Falso pois o plugin fará a gestão
      soundcloud: true
      http: true

httpConfig:
  # Dados do teu Proxy Residencial (ex: DataImpulse / IPRoyal)
  proxyHost: "proxy.exemplo.com"
  proxyPort: 823
  proxyUser: "nome_usuario_proxy"
  proxyPassword: "senha_proxy"

plugins:
  youtube:
    potokenUrl: "https://url-do-seu-potoken-gerado.vercel.app/token"
    enabled: true
    remoteCipher:
      url: "https://cipher.kikkia.dev/"
      userAgent: "SEU AGENT"
    allowSearch: true
    allowDirectVideoIds: true
    allowDirectPlaylistIds: true
    clients:
      - "MUSIC"
      - "TV"
      - "ANDROID_VR"
      - "WEB"
      - "WEBEMBEDDED"
    oauth:
      enabled: true
      # Cola aqui o token exato que o Lavalink gerou nos logs:
      refreshToken: "1//O_SEU_REFRESH_TOKEN_GERADO_AQUI"
      # Altera para true, para que ele pare de pedir o código no site da Google:
      skipInitialization: true
```

### Passo 4: O Bot Node.js

No projeto raiz do bot, instala as dependências necessárias:
```bash
npm install discord.js shoukaku dotenv
```

Cria um ficheiro **`.env`** com os teus tokens de bot reais.
```env
BOT_MAIN_TOKEN=MTEw...TokenDoPrincipal
BOT_2_TOKEN=MTEw...TokenDoCloneDois
BOT_3_TOKEN=MTEw...TokenDoCloneTres
BOT_4_TOKEN=MTEw...TokenDoCloneQuatro

MAIN_CLIENT_ID=123456789012345678
LAVALINK_PASSWORD=coloque_a_mesma_senha_forte_do_passo_3
```

Exemplo de **`discloud.config`** para a hospedagem do Bot:
```ini
NAME=KageBunshinBot
TYPE=bot
MAIN=index.js
RAM=512
VERSION=latest
AUTORESTART=true
```

### Passo 5: Inicialização

1. No painel do **Discord Developer (OAuth2)**, certifica-te de que todos os 4 bots possuem a intent **Message Content Intent** ativa nas configurações de "Bot".
2. Convida os 4 bots para o teu servidor.
3. Inicia o servidor Lavalink primeiro.
4. Inicia o projeto Node.js do bot.
5. O Kage Bunshin principal irá encarregar-se de se ligar à Shoukaku e levantar todos os clones filhos automaticamente. Aproveita o teu novo ecossistema de áudio inquebrável!

---

## 🛡️ Resumo das Soluções Anti-Bloqueio Implementadas

As medidas adotadas na arquitetura garantem uma operação contínua mesmo perante as rígidas políticas do YouTube:

1. **Proxy DataImpulse (`httpConfig`):** O tráfego do Lavalink passa por um IP residencial, mascarando a origem de datacenter da hospedagem.
2. **poToken Generator (`potokenUrl`):** Um serviço externo na Vercel injeta tokens atualizados de prova de origem no plugin do YouTube de 30 em 30 minutos.
3. **OAuth2 (`refreshToken`):** Acesso autenticado ao YouTube (login via TV) para contornar bloqueios de vídeos com restrição de idade ou conteúdo explícito.
4. **Remote Cipher (`remoteCipher`):** Delegação da decifração de assinaturas do YouTube para uma API externa (`cipher.kikkia.dev`), mitigando quebras constantes quando o YouTube atualiza o seu código JavaScript.