require('dotenv').config();
const cluster = require('cluster');
const fs = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, 'runtime-config.json');
const FAVORITES_FILE = path.join(__dirname, 'favorites.json');

const BOTS = [
  { name: 'MAIN',     tokenEnv: 'BOT_MAIN_TOKEN', displayName: 'Kage Bunshin 1', isMain: true },
  { name: 'WORKER_2', tokenEnv: 'BOT_2_TOKEN',    displayName: 'Kage Bunshin 2', isMain: false },
  { name: 'WORKER_3', tokenEnv: 'BOT_3_TOKEN',    displayName: 'Kage Bunshin 3', isMain: false },
  { name: 'WORKER_4', tokenEnv: 'BOT_4_TOKEN',    displayName: 'Kage Bunshin 4', isMain: false },
];

const MAIN_BOT_NAME = 'MAIN';

process.on('unhandledRejection', (error) => {
  console.error('[Segurança] Promessa rejeitada não tratada:', error?.message || error);
});

process.on('uncaughtException', (error) => {
  console.error('[Segurança] Exceção não capturada:', error?.message || error);
});

function cleanUrl(url) {
  if (!url || typeof url !== 'string') return url;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes('youtube.com')) {
      const v = u.searchParams.get('v');
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    }
    if (u.hostname === 'youtu.be') {
      return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
    }
    if (u.hostname.includes('spotify.com')) {
      return `${u.origin}${u.pathname}`;
    }
    if (u.hostname.includes('soundcloud.com')) {
      return `${u.origin}${u.pathname}`;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return trimmed;
  }
}

if (cluster.isPrimary) {
  const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

  const requiredEnvVars = BOTS.map(b => b.tokenEnv).concat(['MAIN_CLIENT_ID']);
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.warn('⚠️ [Segurança] Variáveis de ambiente ausentes:', missingVars.join(', '));
  }

  setInterval(() => {
    console.log('💓 [Manager] Heartbeat enviado em', new Date().toISOString());
  }, 5 * 60 * 1000);

  let runtimeConfig = { guilds: {} };
  if (fs.existsSync(CONFIG_FILE)) {
    try { runtimeConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch {}
    if (!runtimeConfig.guilds) runtimeConfig.guilds = {};
  }

  let favoritesStore = { users: {} };
  if (fs.existsSync(FAVORITES_FILE)) {
    try {
      favoritesStore = JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf-8'));
      if (!favoritesStore.users || typeof favoritesStore.users !== 'object') favoritesStore = { users: {} };
    } catch (e) {
      console.error('[Manager] Não foi possível ler favorites.json:', e.message);
      favoritesStore = { users: {} };
    }
  }

  const saveFavorites = () => {
    const tempFile = `${FAVORITES_FILE}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(favoritesStore, null, 2));
      fs.renameSync(tempFile, FAVORITES_FILE);
    } catch (e) {
      try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
      console.error('[Manager] Erro ao salvar favoritos:', e.message);
      throw e;
    }
  };

  const saveConfig = () => {
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(runtimeConfig, null, 2));
    } catch (e) {
      console.error('[Manager] Erro ao salvar config:', e.message);
    }
  };
  const getCommandChannel = (guildId) => runtimeConfig.guilds[guildId]?.commandChannelId || null;
  const setCommandChannel = (guildId, channelId) => {
    if (!runtimeConfig.guilds[guildId]) runtimeConfig.guilds[guildId] = {};
    runtimeConfig.guilds[guildId].commandChannelId = channelId;
    saveConfig();
  };
  const unsetCommandChannel = (guildId) => {
    if (runtimeConfig.guilds[guildId]) {
      delete runtimeConfig.guilds[guildId].commandChannelId;
      saveConfig();
    }
  };

  const botStates = new Map();
  const workersByName = new Map();
  const panelOwners = new Map();
  const displayName = (internalName) => BOTS.find((b) => b.name === internalName)?.displayName || internalName;

  const registerBot = (name) => {
    if (!botStates.has(name)) {
      botStates.set(name, { name, busy: false, guildId: null, channelId: null });
    }
  };
  const getFreeBot = () => {
    for (const [name, s] of botStates) if (!s.busy) return name;
    return null;
  };
  const markBusy = (name, guildId, channelId) => {
    const s = botStates.get(name);
    if (s) { s.busy = true; s.guildId = guildId; s.channelId = channelId; }
  };
  const markFree = (name) => {
    const s = botStates.get(name);
    if (s) { s.busy = false; s.guildId = null; s.channelId = null; }
  };
  const findBotInChannel = (guildId, channelId) => {
    for (const [name, s] of botStates) {
      if (s.busy && s.guildId === guildId && s.channelId === channelId) return name;
    }
    return null;
  };
  const statusString = () => {
    const all = Array.from(botStates.values());
    if (!all.length) return 'Nenhum bot registrado ainda.';
    return all
      .map((b) => b.busy
        ? `🔴 **${displayName(b.name)}** — tocando em <#${b.channelId}>`
        : `🟢 **${displayName(b.name)}** — livre`)
      .join('\n');
  };

  const editInteractionReply = async (applicationId, interactionToken, payload) => {
    try {
      const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeof payload === 'string' ? { content: payload } : payload),
      }).catch((e) => {
        console.error('[Manager] Falha ao editar interação:', e.message);
        return null;
      });
      if (res && !res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`[Manager] Falha (HTTP ${res.status}):`, body);
      }
    } catch (e) {
      console.error('[Manager] Erro ao editar interação:', e.message);
    }
  };

  const sendToBot = (name, msg) => {
    const w = workersByName.get(name);
    if (w) {
      try {
        w.send(msg);
      } catch (e) {
        console.error(`[Manager] Erro ao enviar msg para ${name}:`, e.message);
      }
    } else {
      console.error(`[Manager] worker ${name} não existe!`);
    }
  };

  const handleWorkerMessage = (fromBot, msg) => {
    try {
      if (msg.type === 'ready') {
        registerBot(msg.name);
        console.log(`[Manager] ${displayName(msg.name)} pronto.`);
        return;
      }

      if (msg.type === 'set_command_channel') {
        setCommandChannel(msg.guildId, msg.channelId);
        console.log(`[Manager] Canal de comandos definido para <#${msg.channelId}>.`);
        return;
      }

      if (msg.type === 'unset_command_channel') {
        unsetCommandChannel(msg.guildId);
        console.log(`[Manager] Restrição de canal removida.`);
        return;
      }

      if (msg.type === 'status_request') {
        editInteractionReply(msg.applicationId, msg.interactionToken, statusString());
        return;
      }

      if (msg.type === 'bot_freed') {
        markFree(msg.name);
        console.log(`[Manager] ${displayName(msg.name)} liberado.`);
        return;
      }

      if (msg.type === 'request_play') {
        const { guildId, voiceChannelId, textChannelId, interactionToken, applicationId } = msg;

        const allowedChannel = getCommandChannel(guildId);
        if (allowedChannel && textChannelId !== allowedChannel) {
          return editInteractionReply(
            applicationId,
            interactionToken,
            `❌ Comandos de música só podem ser usados em <#${allowedChannel}>.`
          );
        }

        const existingBot = findBotInChannel(guildId, voiceChannelId);
        if (existingBot) {
          if (msg.panelMessageId) panelOwners.set(`${guildId}:${msg.panelMessageId}`, existingBot);
          sendToBot(existingBot, { ...msg, type: 'execute_play' });
          return;
        }

        const freeBot = getFreeBot();
        if (!freeBot) {
          return editInteractionReply(
            applicationId,
            interactionToken,
            '❌ Todos os Kage Bunshin estão ocupados. Tente novamente em instantes.'
          );
        }

        markBusy(freeBot, guildId, voiceChannelId);
        if (msg.panelMessageId) panelOwners.set(`${guildId}:${msg.panelMessageId}`, freeBot);
        sendToBot(freeBot, { ...msg, type: 'execute_play' });
        console.log(`[Manager] ${displayName(freeBot)} designado para "${msg.query}"`);
        return;
      }

      if (msg.type === 'request_favorite_toggle') {
        const owner = panelOwners.get(`${msg.guildId}:${msg.panelMessageId}`);
        if (!owner) {
          return editInteractionReply(msg.applicationId, msg.interactionToken,
            'Não encontrei uma reprodução ativa ligada a este painel. Inicie a música por ele e tente novamente.');
        }
        sendToBot(owner, { ...msg, type: 'execute_favorite_toggle' });
        return;
      }

      if (msg.type === 'request_favorites_list') {
        const list = favoritesStore.users[String(msg.userId)] || [];
        const recent = list.slice(-10).reverse();
        const description = recent.length
          ? recent.map((item, index) => `**${index + 1}.** [${item.title}](${item.url || 'https://discord.com'}) — ${item.author || 'Artista desconhecido'}`).join('\n')
          : 'Você ainda não favoritou nenhuma música. Use o botão ⭐ no painel durante uma reprodução.';
        editInteractionReply(msg.applicationId, msg.interactionToken, {
          embeds: [{
            title: `⭐ Suas favoritas (${list.length})`,
            description,
            color: 0xf1c40f,
            footer: { text: 'Salvas no seu perfil do Discord • mostrando até 10 recentes' },
          }],
        });
        return;
      }

      if (msg.type === 'favorite_toggle') {
        const userId = String(msg.userId || '');
        if (!/^\d{15,22}$/.test(userId)) {
          return editInteractionReply(msg.applicationId, msg.interactionToken,
            'Não consegui identificar seu ID do Discord para salvar esta música.');
        }
        if (!favoritesStore.users[userId]) favoritesStore.users[userId] = [];
        const list = favoritesStore.users[userId];
        const track = msg.track;
        const favoriteKey = track.url || `${track.title}::${track.author || ''}`.toLowerCase();
        const index = list.findIndex((item) => item.key === favoriteKey);
        let response;
        try {
          if (index >= 0) {
            list.splice(index, 1);
            response = `☆ **${track.title}** removida das suas favoritas.`;
          } else {
            list.push({ key: favoriteKey, ...track, addedAt: new Date().toISOString() });
            response = `⭐ **${track.title}** salva nas suas favoritas.`;
          }
          saveFavorites();
          editInteractionReply(msg.applicationId, msg.interactionToken, response);
        } catch (error) {
          editInteractionReply(msg.applicationId, msg.interactionToken,
            'Não consegui gravar seus favoritos no armazenamento do bot. Verifique as permissões de escrita da pasta.');
        }
        return;
      }

      if (msg.type === 'favorite_toggle_error') {
        editInteractionReply(msg.applicationId, msg.interactionToken, msg.content);
        return;
      }

      if (msg.type === 'request_control') {
        const { guildId, voiceChannelId, interactionToken, applicationId, action, args } = msg;

        const targetBot = findBotInChannel(guildId, voiceChannelId);
        if (!targetBot) {
          return editInteractionReply(
            applicationId,
            interactionToken,
            '❌ Nenhum Kage Bunshin está tocando no seu canal de voz.'
          );
        }

        sendToBot(targetBot, {
          ...msg,
          type: 'execute_control',
          action,
          args,
          interactionToken,
          applicationId,
        });
        return;
      }

      if (msg.type === 'play_started') {
        if (!msg.panelReply) {
          editInteractionReply(
            msg.applicationId,
            msg.interactionToken,
            `✅ **${msg.assignedBot}** está tocando: **${msg.trackTitle}** (\`${msg.source}\`)`
          );
        }
        return;
      }

      if (msg.type === 'play_failed') {
        editInteractionReply(
          msg.applicationId,
          msg.interactionToken,
          `❌ Falha ao tocar: ${msg.error}`
        );
        return;
      }

      if (msg.type === 'control_result') {
        editInteractionReply(msg.applicationId, msg.interactionToken, msg.payload || msg.content);
        return;
      }
    } catch (e) {
      console.error('[Manager] Erro ao processar mensagem do worker:', e.message);
    }
  };

  const registerCommands = async () => {
    const commands = [
      new SlashCommandBuilder().setName('play').setDescription('Toca uma música do YouTube ou Spotify')
        .addStringOption((o) => o.setName('query').setDescription('Link ou nome da música').setRequired(true)).toJSON(),
      new SlashCommandBuilder().setName('skip').setDescription('Pula a música atual').toJSON(),
      new SlashCommandBuilder().setName('stop').setDescription('Para a música e desconecta').toJSON(),
      new SlashCommandBuilder().setName('pause').setDescription('Pausa a música atual').toJSON(),
      new SlashCommandBuilder().setName('resume').setDescription('Retoma a música pausada').toJSON(),
      new SlashCommandBuilder().setName('queue').setDescription('Mostra a fila de músicas').toJSON(),
      new SlashCommandBuilder().setName('nowplaying').setDescription('Mostra a música atual').toJSON(),
      new SlashCommandBuilder().setName('painel').setDescription('Abre o painel interativo de música').toJSON(),
      new SlashCommandBuilder().setName('favoritas').setDescription('Mostra as músicas que você favoritou').toJSON(),
      new SlashCommandBuilder().setName('volume').setDescription('Ajusta o volume (0-100)')
        .addIntegerOption((o) => o.setName('nivel').setDescription('Volume de 0 a 100').setRequired(true).setMinValue(0).setMaxValue(100)).toJSON(),
      new SlashCommandBuilder().setName('loop').setDescription('Alterna o modo de repetição')
        .addStringOption((o) => o.setName('modo').setDescription('Modo de loop').setRequired(true)
          .addChoices(
            { name: 'Off', value: 'off' },
            { name: 'Música', value: 'track' },
            { name: 'Fila', value: 'queue' },
            { name: 'Autoplay', value: 'autoplay' }
          )).toJSON(),
      new SlashCommandBuilder().setName('shuffle').setDescription('Embaralha a fila').toJSON(),
      
      new SlashCommandBuilder().setName('setup').setDescription('Define o canal de comandos deste servidor')
        .addChannelOption((o) => o.setName('canal').setDescription('Canal de texto').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).toJSON(),
      new SlashCommandBuilder().setName('unsetup').setDescription('Remove a restrição de canal')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild).toJSON(),
        
      new SlashCommandBuilder().setName('status').setDescription('Mostra quais bots estão livres ou ocupados').toJSON(),
      new SlashCommandBuilder().setName('help').setDescription('Lista todos os comandos').toJSON(),
    ];

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_MAIN_TOKEN);
    try {
      console.log('[Manager] Registrando comandos globais...');
      await rest.put(Routes.applicationCommands(process.env.MAIN_CLIENT_ID), { body: commands });
      console.log('[Manager] ✅ Comandos registrados.');
    } catch (err) {
      console.error('[Manager] Erro ao registrar comandos:', err);
    }
  };

  for (const bot of BOTS) {
    const token = process.env[bot.tokenEnv];
    if (!token) {
      console.error(`[Manager] Token ausente para ${bot.displayName} (${bot.tokenEnv})`);
      continue;
    }

    const worker = cluster.fork({
      BOT_NAME: bot.name,
      BOT_DISPLAY_NAME: bot.displayName,
      DISCORD_TOKEN: token,
      IS_MAIN: bot.isMain ? 'true' : 'false',
    });

    worker.customBotName = bot.name;
    worker.customDisplayName = bot.displayName;

    workersByName.set(bot.name, worker);
    worker.on('message', (msg) => handleWorkerMessage(bot.name, msg));
  }

  cluster.on('exit', (worker, code) => {
    const name = worker.customBotName;
    const dn = worker.customDisplayName || name;
    console.log(`[Manager] ${dn} caiu (code${code}). Reiniciando...`);
    if (name) markFree(name);
    const bot = BOTS.find((b) => b.name === name);
    if (bot) {
      setTimeout(() => {
        const newWorker = cluster.fork({
          BOT_NAME: bot.name,
          BOT_DISPLAY_NAME: bot.displayName,
          DISCORD_TOKEN: process.env[bot.tokenEnv],
          IS_MAIN: bot.isMain ? 'true' : 'false',
        });
        newWorker.customBotName = bot.name;
        newWorker.customDisplayName = bot.displayName;
        workersByName.set(bot.name, newWorker);
        newWorker.on('message', (msg) => handleWorkerMessage(bot.name, msg));
      }, 5000);
    }
  });

  registerCommands();

} else {
  const {
    Client, GatewayIntentBits, Events, EmbedBuilder,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ModalBuilder, TextInputBuilder, TextInputStyle,
  } = require('discord.js');
  const { Player, QueueRepeatMode } = require('discord-player');
  const { YoutubeExtractor } = require('discord-player-youtubei'); 
  const { SoundCloudExtractor, SpotifyExtractor, AppleMusicExtractor } = require('@discord-player/extractor');

  const BOT_NAME = process.env.BOT_NAME;
  const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME || BOT_NAME;
  const TOKEN = process.env.DISCORD_TOKEN;
  const IS_MAIN = process.env.IS_MAIN === 'true';

  console.log(`[${BOT_DISPLAY_NAME}] iniciando...`);

  if (!TOKEN) {
    console.error(`[${BOT_DISPLAY_NAME}] Token ausente. Encerrando worker.`);
    process.exit(1);
  }

  const workerHeartbeat = setInterval(() => {
    console.log(`💓 [${BOT_DISPLAY_NAME}] Heartbeat em`, new Date().toISOString());
  }, 5 * 60 * 1000);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  const player = new Player(client);
  const activeQueues = new Map();
  const panelRefreshTimers = new Map();

  client.once(Events.ClientReady, async (c) => {
    console.log(`[${BOT_DISPLAY_NAME}] online como${c.user.tag}`);

    const extractors = [
      { name: 'YouTubei', Extractor: YoutubeExtractor, opts: {} },
      { name: 'SoundCloud', Extractor: SoundCloudExtractor, opts: {} },
      { name: 'Spotify', Extractor: SpotifyExtractor, opts: {} },
      { name: 'Apple Music', Extractor: AppleMusicExtractor, opts: {} },
    ];

    for (const { name, Extractor, opts } of extractors) {
      try {
        await player.extractors.register(Extractor, opts);
        console.log(`[${BOT_DISPLAY_NAME}] Extractor${name} registrado.`);
      } catch (err) {
        console.error(`[${BOT_DISPLAY_NAME}] erro${name}:`, err.message);
      }
    }

    if (process.send) process.send({ type: 'ready', name: BOT_NAME });
  });

  player.events.on('playerStart', async (queue, track) => {
    try {
      console.log(`[${BOT_DISPLAY_NAME}] tocando:${track.title}`);
      queue.metadata.panelClock = { startedAt: Date.now(), elapsedMs: 0, paused: false };
      queue.metadata.panelView = queue.metadata.panelView || 'nowplaying';
      if (queue.metadata?.panelMessageId && queue.metadata?.panelChannelId) {
        startPanelTicker(queue);
      } else if (queue.metadata?.channel) {
        queue.metadata.channel.send(
          `▶️ **${BOT_DISPLAY_NAME}** está tocando: **${track.title}** (\`${track.source}\`)`
        ).catch(() => {});
      }
      
      const voiceChannel = queue.guild?.members?.me?.voice?.channel;
      if (voiceChannel && typeof voiceChannel.setStatus === 'function') {
        const statusText = `▶️ ${track.title}\n${track.author}`.substring(0, 499);
        await voiceChannel.setStatus(statusText).catch(() => {});
      }
    } catch (err) {
      console.error(`[${BOT_DISPLAY_NAME}] erro em playerStart:`, err.message);
    }
  });

  player.events.on('audioTrackAdd', async (queue, track) => {
    try {
      if (queue.metadata?.panelMessageId && queue.metadata?.panelChannelId) {
        await updateMusicPanel(queue);
      } else if (queue.metadata?.channel && queue.tracks.size > 0) {
        queue.metadata.channel.send(`➕ Adicionado à fila: **${track.title}**`).catch(() => {});
      }
    } catch (err) {
      console.error(`[${BOT_DISPLAY_NAME}] erro em audioTrackAdd:`, err.message);
    }
  });

  player.events.on('emptyQueue', async (queue) => {
    try {
      if (queue.metadata?.panelMessageId && queue.metadata?.panelChannelId) {
        await updateMusicPanel(queue, true);
      } else if (queue.metadata?.channel) {
        queue.metadata.channel.send(`⏹️ **${BOT_DISPLAY_NAME}** terminou a fila.`).catch(() => {});
      }
      
      const voiceChannel = queue.guild?.members?.me?.voice?.channel;
      if (voiceChannel && typeof voiceChannel.setStatus === 'function') {
        await voiceChannel.setStatus(null).catch(() => {});
      }
    } catch (err) {
      console.error(`[${BOT_DISPLAY_NAME}] erro em emptyQueue:`, err.message);
    }

    stopPanelTicker(queue.guild.id);
    activeQueues.delete(queue.guild.id);
    if (process.send) process.send({ type: 'bot_freed', name: BOT_NAME });
  });

  player.events.on('error', async (queue, error) => {
    console.error(`[${BOT_DISPLAY_NAME}] erro:`, error.message);
    try {
      if (queue?.metadata?.panelMessageId && queue?.metadata?.panelChannelId) {
        await updateMusicPanel(queue, true);
      } else if (queue?.metadata?.channel) {
        queue.metadata.channel.send(`⚠️ Erro: ${error.message}`).catch(() => {});
      }
      
      const voiceChannel = queue?.guild?.members?.me?.voice?.channel;
      if (voiceChannel && typeof voiceChannel.setStatus === 'function') {
        await voiceChannel.setStatus(null).catch(() => {});
      }
    } catch (err) {}

    if (queue?.guild?.id) {
      stopPanelTicker(queue.guild.id);
      activeQueues.delete(queue.guild.id);
    }
    if (process.send) process.send({ type: 'bot_freed', name: BOT_NAME });
  });

  const formatDuration = (ms) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  const repeatModeToString = (mode) => {
    switch (mode) {
      case QueueRepeatMode.OFF: return 'Off';
      case QueueRepeatMode.TRACK: return 'Música';
      case QueueRepeatMode.QUEUE: return 'Fila';
      case QueueRepeatMode.AUTOPLAY: return 'Autoplay';
      default: return 'Desconhecido';
    }
  };

  const musicPanelComponents = () => [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music:play').setLabel('Adicionar').setEmoji('➕').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('music:toggle_pause').setLabel('Pausar / retomar').setEmoji('⏯️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('music:skip').setLabel('Pular').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music:queue').setLabel('Fila').setEmoji('📜').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('music:stop').setLabel('Parar').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('music:favorite').setLabel('Favoritar / remover').setEmoji('⭐').setStyle(ButtonStyle.Secondary),
    ),
  ];

  const getPanelElapsedMs = (queue) => {
    const clock = queue?.metadata?.panelClock;
    if (!clock) return 0;
    const elapsed = clock.elapsedMs + (clock.paused ? 0 : Date.now() - clock.startedAt);
    const total = Number(queue?.currentTrack?.durationMS) || 0;
    return Math.max(0, Math.floor(total > 0 ? Math.min(elapsed, total) : elapsed));
  };

  const setPanelPaused = (queue, paused) => {
    const clock = queue?.metadata?.panelClock;
    if (!clock || clock.paused === paused) return;
    if (paused) {
      clock.elapsedMs = getPanelElapsedMs(queue);
      clock.paused = true;
    } else {
      clock.startedAt = Date.now();
      clock.paused = false;
    }
  };

  const formatPanelTime = (ms) => {
    const seconds = Math.floor(Math.max(0, ms) / 1000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };

  const makeProgressBar = (currentMs, totalMs, width = 20) => {
    if (!totalMs) return '🔴 AO VIVO';
    const progress = Math.max(0, Math.min(1, currentMs / totalMs));
    const markerIndex = Math.min(width - 1, Math.floor(progress * width));
    return Array.from({ length: width }, (_, i) => i === markerIndex ? '🔘' : '▬').join('');
  };

  const buildMusicPanelPayload = (queue = null) => {
    const track = queue?.currentTrack;
    const isPaused = Boolean(queue?.node?.isPaused?.());
    const totalMs = Number(track?.durationMS) || 0;
    const currentMs = getPanelElapsedMs(queue);
    const title = track?.title || 'Nada tocando no momento';
    
    // CORREÇÃO DO REQUISITANTE
    let requesterId = track?.requestedBy?.id || track?.requestedBy?.user?.id;
    if (typeof track?.requestedBy === 'string') requesterId = track.requestedBy;

    const voiceChannelId = queue?.metadata?.voiceChannelId || queue?.guild?.members?.me?.voice?.channelId;
    const description = track
      ? `**[${title}](${track.url || 'https://discord.com'})**\n${track.author || 'Artista desconhecido'}\n\n\`${formatPanelTime(currentMs)}\` ${makeProgressBar(currentMs, totalMs)} \`${totalMs ? formatPanelTime(totalMs) : 'LIVE'}\``
      : 'Escolha uma música para começar. Clique em **Adicionar** e pesquise por nome ou cole um link.';
      
    const embed = new EmbedBuilder()
      .setColor(track ? (isPaused ? 0xf1c40f : 0x5865f2) : 0x2b2d31)
      .setAuthor({ name: 'KAGE BUNSHIN • MUSIC PLAYER' })
      .setTitle(track ? 'Tocando agora' : 'Seu player de música')
      .setDescription(description)
      .addFields(
        { name: 'STATUS', value: track ? (isPaused ? '⏸️ Pausado' : '🔊 Tocando') : '💤 Aguardando', inline: true },
        { name: 'NA FILA', value: `${queue?.tracks?.size ?? 0} música(s)`, inline: true },
        { name: 'PEDIDA POR', value: requesterId ? `<@${requesterId}>` : 'Não informado', inline: true },
        { name: 'TOCANDO EM', value: voiceChannelId ? `<#${voiceChannelId}>` : 'Canal não identificado', inline: true },
      )
      .setFooter({ text: 'Kage Bunshin • painel interativo' });

    if (track?.thumbnail && /^https?:\/\//i.test(track.thumbnail)) {
      embed.setThumbnail(track.thumbnail);
    }

    if (queue) {
      const upcoming = queue.tracks.toArray().slice(0, 8);
      const queueText = upcoming.length
        ? upcoming.map((item, index) => `**${index + 1}.** ${item.title} —${item.durationMS ? formatDuration(item.durationMS) : 'Ao vivo'}`).join('\n').slice(0, 1024)
        : 'A fila está vazia.';
      embed.addFields({ name: 'PRÓXIMAS', value: queueText });
    }

    return { embeds: [embed.toJSON()], components: musicPanelComponents().map((row) => row.toJSON()) };
  };

  const updateMusicPanel = async (queue, empty = false) => {
    const metadata = queue?.metadata;
    if (!metadata?.panelMessageId || !metadata?.panelChannelId) return;
    try {
      const channel = client.channels.cache.get(metadata.panelChannelId)
        || await client.channels.fetch(metadata.panelChannelId).catch(() => null);
      if (!channel?.messages) return;
      const message = channel.messages.cache.get(metadata.panelMessageId)
        || await channel.messages.fetch(metadata.panelMessageId).catch(() => null);
      if (message) {
        await message.edit(buildMusicPanelPayload(empty ? null : queue));
      }
    } catch (error) {
      console.error(`[${BOT_DISPLAY_NAME}] erro ao atualizar painel:`, error.message);
    }
  };

  const startPanelTicker = (queue) => {
    const guildId = queue.guild.id;
    stopPanelTicker(guildId);
    const timer = setInterval(() => {
      if (!queue.currentTrack || queue.node.isPaused()) return;
      updateMusicPanel(queue);
    }, 10_000);
    timer.unref?.();
    panelRefreshTimers.set(guildId, timer);
    updateMusicPanel(queue);
  };

  const stopPanelTicker = (guildId) => {
    const timer = panelRefreshTimers.get(guildId);
    if (timer) clearInterval(timer);
    panelRefreshTimers.delete(guildId);
  };

  const helpEmbed = new EmbedBuilder()
    .setTitle('🎵 Kage Bunshin — Comandos')
    .setDescription('Todos os clones em um só lugar. Use os comandos abaixo para controlar a música.')
    .setColor(0x9b59b6)
    .setThumbnail('https://i.imgur.com/AfFp7pu.png')
    .addFields(
      {
        name: '🎶 Reprodução',
        value: [
          '`/play <música>` — toca uma música (YouTube, Spotify, SoundCloud)',
          '`/skip` — pula para a próxima',
          '`/stop` — para tudo e desconecta',
          '`/pause` — pausa a música atual',
          '`/resume` — retoma a música pausada',
        ].join('\n'),
      },
      {
        name: '📋 Fila',
        value: [
          '`/queue` — mostra a fila de músicas',
          '`/nowplaying` — mostra a música tocando agora',
          '`/painel` — abre os controles interativos de música',
          '`/favoritas` — lista suas músicas salvas pelo seu ID Discord',
          '`/shuffle` — embaralha a fila',
          '`/loop <modo>` — repete (off / track / queue / autoplay)',
        ].join('\n'),
      },
      {
        name: '⚙️ Ajustes',
        value: [
          '`/volume <0-100>` — ajusta o volume',
          '`/setup <canal>` — define o canal de comandos (Apenas Admins)',
          '`/unsetup` — remove a restrição de canal (Apenas Admins)',
        ].join('\n'),
      },
      {
        name: 'ℹ️ Outros',
        value: [
          '`/status` — mostra quais clones estão livres',
          '`/help` — mostra esta mensagem',
        ].join('\n'),
      }
    )
    .setFooter({ text: 'Kage Bunshin • 4 clones ao seu dispor' })
    .setTimestamp();

  if (IS_MAIN) {
    const { PermissionFlagsBits } = require('discord.js');
    
    client.on(Events.InteractionCreate, async (interaction) => {
      try {
        const guildId = interaction.guildId;
        const interactionToken = interaction.token;
        const applicationId = client.application.id;

        if (interaction.isButton()) {
          if (interaction.customId === 'music:favorite') {
            await interaction.deferReply({ flags: 64 });
            if (process.send) {
              process.send({
                type: 'request_favorite_toggle',
                guildId,
                panelMessageId: interaction.message.id,
                userId: interaction.user.id,
                interactionToken,
                applicationId,
              });
            }
            return;
          }

          if (interaction.customId === 'music:play') {
            const modal = new ModalBuilder()
              .setCustomId(`music:play_modal:${interaction.message.id}:${interaction.channelId}`)
              .setTitle('Adicionar música à fila');
            const queryInput = new TextInputBuilder()
              .setCustomId('query')
              .setLabel('Nome da música ou link')
              .setPlaceholder('Ex.: nome da música, YouTube ou Spotify')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(200);
            modal.addComponents(new ActionRowBuilder().addComponents(queryInput));
            return interaction.showModal(modal);
          }

          const buttonActions = {
            'music:toggle_pause': 'toggle_pause',
            'music:skip': 'skip',
            'music:queue': 'queue',
            'music:shuffle': 'shuffle',
            'music:stop': 'stop',
          };
          const action = buttonActions[interaction.customId];
          if (!action) return;

          const voiceChannel = interaction.member?.voice?.channel;
          if (!voiceChannel) {
            return interaction.reply({ content: 'Entre em um canal de voz para controlar a música.', flags: 64 });
          }
          await interaction.deferUpdate();
          if (process.send) {
            process.send({
              type: 'request_control', action, args: {}, guildId,
              voiceChannelId: voiceChannel.id,
              interactionToken, applicationId,
              panelMessageId: interaction.message.id,
            });
          }
          return;
        }

        if (interaction.isModalSubmit() && interaction.customId.startsWith('music:play_modal:')) {
          const voiceChannel = interaction.member?.voice?.channel;
          if (!voiceChannel) {
            return interaction.reply({ content: 'Entre em um canal de voz primeiro.', flags: 64 });
          }
          const [, , panelMessageId, panelChannelId] = interaction.customId.split(':');
          const query = cleanUrl(interaction.fields.getTextInputValue('query'));
          await interaction.deferReply({ flags: 64 });
          if (process.send) {
            process.send({
              type: 'request_play', query,
              guildId,
              voiceChannelId: voiceChannel.id,
              textChannelId: interaction.channelId,
              requesterId: interaction.user.id,
              requesterName: interaction.user.username,
              interactionToken, applicationId,
              panelMessageId, panelChannelId,
            });
          }
          return;
        }

        if (!interaction.isChatInputCommand()) return;
        const cmd = interaction.commandName;

        if (cmd === 'painel') {
          return interaction.reply(buildMusicPanelPayload(null));
        }

        if (cmd === 'favoritas') {
          await interaction.deferReply({ flags: 64 });
          if (process.send) {
            process.send({ type: 'request_favorites_list', userId: interaction.user.id, interactionToken, applicationId });
          }
          return;
        }

        if (cmd === 'setup' || cmd === 'unsetup') {
          if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return interaction.reply({
              content: '❌ Apenas administradores e moderadores (com permissão de Gerenciar Servidor) podem usar este comando.',
              flags: 64,
            });
          }

          if (cmd === 'setup') {
            const channel = interaction.options.getChannel('canal');
            if (!channel || !channel.isTextBased()) {
              return interaction.reply({ content: '❌ Informe um canal de texto válido.', flags: 64 });
            }
            if (process.send) process.send({ type: 'set_command_channel', guildId, channelId: channel.id });
            return interaction.reply({
              content: `✅ Canal de comandos definido para <#${channel.id}>.`,
              flags: 64,
            });
          }

          if (cmd === 'unsetup') {
            if (process.send) process.send({ type: 'unset_command_channel', guildId });
            return interaction.reply({ content: '✅ Restrição de canal removida.', flags: 64 });
          }
        }

        if (cmd === 'status') {
          await interaction.deferReply();
          if (process.send) process.send({ type: 'status_request', guildId, interactionToken, applicationId });
          return;
        }

        if (cmd === 'help') {
          return interaction.reply({ embeds: [helpEmbed], flags: 64 });
        }

        if (cmd === 'play') {
          const query = cleanUrl(interaction.options.getString('query'));
          const voiceChannel = interaction.member?.voice?.channel;
          if (!voiceChannel) return interaction.reply({ content: '❌ Entre em um canal de voz primeiro.', flags: 64 });
          await interaction.deferReply();
          await interaction.editReply(buildMusicPanelPayload(null));
          const panelMessage = await interaction.fetchReply();
          if (process.send) {
            process.send({
              type: 'request_play', query, guildId,
              voiceChannelId: voiceChannel.id,
              textChannelId: interaction.channelId,
              requesterId: interaction.user.id,
              requesterName: interaction.user.username,
              interactionToken, applicationId,
              panelMessageId: panelMessage.id,
              panelChannelId: interaction.channelId,
              panelReply: true,
            });
          }
          return;
        }

        const controlCommands = ['skip', 'stop', 'pause', 'resume', 'queue', 'nowplaying', 'volume', 'loop', 'shuffle'];
        if (controlCommands.includes(cmd)) {
          const voiceChannel = interaction.member?.voice?.channel;
          if (!voiceChannel) return interaction.reply({ content: '❌ Entre em um canal de voz primeiro.', flags: 64 });
          await interaction.deferReply();
          const args = {};
          if (cmd === 'volume') args.level = interaction.options.getInteger('nivel');
          if (cmd === 'loop') args.mode = interaction.options.getString('modo');
          if (process.send) {
            process.send({
              type: 'request_control', action: cmd, args,
              guildId, voiceChannelId: voiceChannel.id,
              interactionToken, applicationId,
            });
          }
        }
      } catch (error) {
        console.error(`[${BOT_DISPLAY_NAME}] Erro no interactionCreate:`, error.message);
        try {
          const response = { content: '❌ Ocorreu um erro ao processar a interação.', flags: 64 };
          if (interaction.deferred || interaction.replied) await interaction.followUp(response);
          else await interaction.reply(response);
        } catch (e) {}
      }
    });
  }

  process.on('message', async (msg) => {
    try {
      if (msg.type === 'execute_play') {
        try {
          const guild = client.guilds.cache.get(msg.guildId);
          if (!guild) throw new Error('Servidor não encontrado');

          const voiceChannel = guild.channels.cache.get(msg.voiceChannelId);
          if (!voiceChannel) throw new Error('Canal de voz não encontrado');

          const textChannel = guild.channels.cache.get(msg.textChannelId);

          let queue = activeQueues.get(msg.guildId);

          if (!queue) {
            queue = player.nodes.create(guild, {
              metadata: { channel: textChannel, panelChannelId: msg.panelChannelId, panelMessageId: msg.panelMessageId, voiceChannelId: msg.voiceChannelId },
              leaveOnEmpty: false,
              leaveOnEnd: false,
              selfDeaf: true,
              selfMute: false,
              volume: 50,
            });

            if (!queue.connection) await queue.connect(voiceChannel);
            queue.node.setVolume(50);

            activeQueues.set(msg.guildId, queue);
          }

          queue.metadata.voiceChannelId = msg.voiceChannelId;
          if (msg.panelMessageId && msg.panelChannelId) {
            queue.metadata.panelMessageId = msg.panelMessageId;
            queue.metadata.panelChannelId = msg.panelChannelId;
          }

          const requester = { id: msg.requesterId, username: msg.requesterName || '' };
          let result = await player.search(msg.query, {
            requestedBy: requester,
            searchEngine: 'youtube',
          });

          if (!result.hasTracks()) {
            console.log(`[${BOT_DISPLAY_NAME}] YouTube falhou, tentando SoundCloud...`);
            result = await player.search(msg.query, {
              requestedBy: requester,
              searchEngine: 'soundcloud',
            });
          }

          if (!result.hasTracks()) throw new Error('Nenhum resultado encontrado.');

          const track = result.tracks[0];
          
          // FORÇA O REQUISITANTE NO OBJETO DA MÚSICA PARA O EMBED LER
          track.requestedBy = msg.requesterId;

          queue.addTrack(track);
          if (!queue.isPlaying()) await queue.node.play();

          if (process.send) {
            process.send({
              type: 'play_started',
              assignedBot: BOT_DISPLAY_NAME,
              interactionToken: msg.interactionToken,
              applicationId: msg.applicationId,
              trackTitle: result.tracks[0].title,
              source: result.tracks[0].source,
              panelReply: Boolean(msg.panelReply),
            });
          }
        } catch (err) {
          console.error(`[${BOT_DISPLAY_NAME}] erro no play:`, err.message);
          if (process.send) {
            process.send({
              type: 'play_failed',
              assignedBot: BOT_DISPLAY_NAME,
              interactionToken: msg.interactionToken,
              applicationId: msg.applicationId,
              error: err.message,
            });
          }
        }
        return;
      }

      if (msg.type === 'execute_favorite_toggle') {
        const queue = activeQueues.get(msg.guildId);
        const track = queue?.currentTrack;
        if (!track) {
          if (process.send) process.send({
            type: 'favorite_toggle_error',
            interactionToken: msg.interactionToken,
            applicationId: msg.applicationId,
            content: 'Não há uma música tocando neste painel para favoritar.',
          });
          return;
        }
        if (process.send) process.send({
          type: 'favorite_toggle',
          userId: msg.userId,
          interactionToken: msg.interactionToken,
          applicationId: msg.applicationId,
          track: {
            title: track.title,
            author: track.author || '',
            url: track.url || '',
            source: track.source || '',
            thumbnail: track.thumbnail || '',
            durationMS: Number(track.durationMS) || 0,
          },
        });
        return;
      }

      if (msg.type === 'execute_control') {
        const { action, args, interactionToken, applicationId } = msg;
        let content = '';

        try {
          const queue = activeQueues.get(msg.guildId);
          if (!queue?.connection) throw new Error('Nenhuma fila ativa neste servidor.');

          switch (action) {
            case 'skip': {
              if (!queue.currentTrack) throw new Error('Nada está tocando.');
              const skipped = queue.currentTrack.title;
              queue.node.skip();
              content = `⏭️ Pulei: **${skipped}**`;
              break;
            }
            case 'stop': {
              try {
                const voiceChannel = queue.guild?.members?.me?.voice?.channel;
                if (voiceChannel && typeof voiceChannel.setStatus === 'function') {
                  voiceChannel.setStatus(null).catch(() => {});
                }
              } catch (err) {}
              
              stopPanelTicker(queue.guild.id);
              activeQueues.delete(queue.guild.id);
              queue.delete();
              content = '⏹️ Parado e desconectado.';
              if (process.send) process.send({ type: 'bot_freed', name: BOT_NAME });
              break;
            }
            case 'toggle_pause':
              if (queue.node.isPaused()) {
                queue.node.resume();
                setPanelPaused(queue, false);
                content = '▶️ Reprodução retomada.';
              } else {
                queue.node.pause();
                setPanelPaused(queue, true);
                content = '⏸️ Reprodução pausada.';
              }
              break;
            case 'pause':
              queue.node.pause();
              setPanelPaused(queue, true);
              content = '⏸️ Pausado.';
              break;
            case 'resume':
              queue.node.resume();
              setPanelPaused(queue, false);
              content = '▶️ Retomado.';
              break;
            case 'queue': {
              const current = queue.currentTrack;
              const upcoming = queue.tracks.toArray().slice(0, 10);
              const lines = [];
              if (current) lines.push(`**Tocando:** ${current.title} \`[${formatDuration(current.durationMS)}]\``);
              if (upcoming.length) {
                lines.push('');
                lines.push('**Próximas:**');
                upcoming.forEach((t, i) => lines.push(`\`${i + 1}.\` ${t.title} \`[${formatDuration(t.durationMS)}]\``));
              } else {
                lines.push('');
                lines.push('_Fila vazia._');
              }
              content = lines.join('\n');
              break;
            }
            case 'nowplaying': {
              const current = queue.currentTrack;
              if (!current) throw new Error('Nada está tocando.');
              content = `🎶 **${current.title}** — \`${current.author}\` \`[${formatDuration(current.durationMS)}]\` (\`${current.source}\`)`;
              break;
            }
            case 'volume':
              queue.node.setVolume(args.level);
              content = `🔊 Volume ajustado para **${args.level}%**.`;
              break;
            case 'loop': {
              const map = {
                off: QueueRepeatMode.OFF,
                track: QueueRepeatMode.TRACK,
                queue: QueueRepeatMode.QUEUE,
                autoplay: QueueRepeatMode.AUTOPLAY,
              };
              queue.setRepeatMode(map[args.mode]);
              content = `🔁 Loop definido para **${repeatModeToString(map[args.mode])}**.`;
              break;
            }
            case 'shuffle':
              queue.tracks.shuffle();
              content = '🔀 Fila embaralhada.';
              break;
            default:
              throw new Error(`Ação desconhecida: ${action}`);
          }
        } catch (err) {
          content = `❌ ${err.message}`;
        }

        const currentQueue = activeQueues.get(msg.guildId) || null;
        if (process.send) {
          process.send({
            type: 'control_result', interactionToken, applicationId, content,
            payload: buildMusicPanelPayload(currentQueue),
          });
        }
        return;
      }
    } catch (e) {
      console.error(`[${BOT_DISPLAY_NAME}] Erro ao processar mensagem:`, e.message);
    }
  });

  client.on('error', (error) => {
    console.error(`[${BOT_DISPLAY_NAME}] Erro no cliente Discord:`, error.message);
  });

  client.on('disconnect', () => {
    console.log(`⚠️ [${BOT_DISPLAY_NAME}] Bot desconectado. Tentando reconectar...`);
  });

  client.on('shardDisconnect', () => {
    console.log(`⚠️ [${BOT_DISPLAY_NAME}] Shard desconectado. Tentando reconectar...`);
  });

  client.login(TOKEN).catch((error) => {
    console.error(`[${BOT_DISPLAY_NAME}] Erro ao fazer login:`, error.message);
    clearInterval(workerHeartbeat);
    process.exit(1);
  });
}