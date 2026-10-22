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
    return trimmed;
  } catch {
    return trimmed;
  }
}

if (cluster.isPrimary) {

  const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits, Client, Events, ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, GatewayIntentBits } = require('discord.js');

  const requiredEnvVars = BOTS.map(b => b.tokenEnv).concat(['MAIN_CLIENT_ID', 'LAVALINK_PASSWORD']);
  const missingVars = requiredEnvVars.filter(v => !process.env[v]);
  if (missingVars.length > 0) {
    console.warn('⚠️ [Segurança] Variáveis de ambiente ausentes:', missingVars.join(', '));
  }

  let runtimeConfig = { guilds: {} };
  if (fs.existsSync(CONFIG_FILE)) {
    try { runtimeConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8')); } catch {}
  }

  let favoritesStore = { users: {} };
  if (fs.existsSync(FAVORITES_FILE)) {
    try { favoritesStore = JSON.parse(fs.readFileSync(FAVORITES_FILE, 'utf-8')); } catch {}
  }

  const saveFavorites = () => fs.writeFileSync(FAVORITES_FILE, JSON.stringify(favoritesStore, null, 2));
  const saveConfig = () => fs.writeFileSync(CONFIG_FILE, JSON.stringify(runtimeConfig, null, 2));

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

  const registerBot = (name) => { if (!botStates.has(name)) botStates.set(name, { name, busy: false, guildId: null, channelId: null }); };
  const getFreeBot = () => { for (const [name, s] of botStates) if (!s.busy) return name; return null; };
  const markBusy = (name, guildId, channelId) => { const s = botStates.get(name); if (s) { s.busy = true; s.guildId = guildId; s.channelId = channelId; } };
  const markFree = (name) => { const s = botStates.get(name); if (s) { s.busy = false; s.guildId = null; s.channelId = null; } };
  const findBotInChannel = (guildId, channelId) => { for (const [name, s] of botStates) { if (s.busy && s.guildId === guildId && s.channelId === channelId) return name; } return null; };

  const editInteractionReply = async (applicationId, interactionToken, payload) => {
    try {
      const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
      await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(typeof payload === 'string' ? { content: payload } : payload) }).catch(() => null);
    } catch (e) {}
  };

  const sendToBot = (name, msg) => { const w = workersByName.get(name); if (w) w.send(msg); };

  const handleWorkerMessage = (fromBot, msg) => {
    if (msg.type === 'ready') { registerBot(msg.name); console.log(`[Manager] ${displayName(msg.name)} pronto.`); return; }
    if (msg.type === 'bot_freed') { markFree(msg.name); console.log(`[Manager] ${displayName(msg.name)} libertado.`); return; }
    if (msg.type === 'status_request') {
      const statusString = Array.from(botStates.values()).map((b) => b.busy ? `🔴 **${displayName(b.name)}** — a tocar em <#${b.channelId}>` : `🟢 **${displayName(b.name)}** — livre`).join('\n');
      editInteractionReply(msg.applicationId, msg.interactionToken, statusString || 'Nenhum bot registado.'); return;
    }
    if (msg.type === 'request_play') {
      const allowedChannel = getCommandChannel(msg.guildId);
      if (allowedChannel && msg.textChannelId !== allowedChannel) return editInteractionReply(msg.applicationId, msg.interactionToken, `❌ Comandos só podem ser usados em <#${allowedChannel}>.`);

      const existingBot = findBotInChannel(msg.guildId, msg.voiceChannelId);
      if (existingBot) {
        if (msg.panelMessageId) panelOwners.set(`${msg.guildId}:${msg.panelMessageId}`, existingBot);
        return sendToBot(existingBot, { ...msg, type: 'execute_play' });
      }

      const freeBot = getFreeBot();
      if (!freeBot) return editInteractionReply(msg.applicationId, msg.interactionToken, '❌ Todos os clones estão ocupados. Tenta em instantes.');

      markBusy(freeBot, msg.guildId, msg.voiceChannelId);
      if (msg.panelMessageId) panelOwners.set(`${msg.guildId}:${msg.panelMessageId}`, freeBot);
      sendToBot(freeBot, { ...msg, type: 'execute_play' });
      return;
    }
    if (msg.type === 'request_control') {
      const targetBot = findBotInChannel(msg.guildId, msg.voiceChannelId);
      if (!targetBot) return editInteractionReply(msg.applicationId, msg.interactionToken, '❌ Nenhum clone está a tocar no teu canal.');
      return sendToBot(targetBot, { ...msg, type: 'execute_control' });
    }
    if (msg.type === 'request_favorite_toggle') {
      const owner = panelOwners.get(`${msg.guildId}:${msg.panelMessageId}`);
      if (!owner) return editInteractionReply(msg.applicationId, msg.interactionToken, 'Não há reprodução ativa para este painel.');
      return sendToBot(owner, { ...msg, type: 'execute_favorite_toggle' });
    }
    if (msg.type === 'favorite_toggle') {
      const userId = String(msg.userId || '');
      if (!favoritesStore.users[userId]) favoritesStore.users[userId] = [];
      const list = favoritesStore.users[userId];
      const track = msg.track;
      const favoriteKey = track.url || track.title.toLowerCase();
      const index = list.findIndex((item) => item.key === favoriteKey);
      if (index >= 0) { list.splice(index, 1); editInteractionReply(msg.applicationId, msg.interactionToken, `☆ **${track.title}** removida das tuas favoritas.`); }
      else { list.push({ key: favoriteKey, ...track, addedAt: new Date().toISOString() }); editInteractionReply(msg.applicationId, msg.interactionToken, `⭐ **${track.title}** guardada nas tuas favoritas.`); }
      return saveFavorites();
    }
    if (msg.type === 'play_started') { if (!msg.panelReply) editInteractionReply(msg.applicationId, msg.interactionToken, `✅ **${msg.assignedBot}** a tocar: **${msg.trackTitle}**`); return; }
    if (msg.type === 'play_failed' || msg.type === 'favorite_toggle_error') return editInteractionReply(msg.applicationId, msg.interactionToken, msg.error || msg.content);
    if (msg.type === 'control_result') return editInteractionReply(msg.applicationId, msg.interactionToken, msg.payload || msg.content);
  };

  const registerCommands = async () => {
    const commands = [
      new SlashCommandBuilder().setName('play').setDescription('Toca uma música').addStringOption((o) => o.setName('query').setDescription('Link ou nome').setRequired(true)).toJSON(),
      new SlashCommandBuilder().setName('skip').setDescription('Pula a música atual').toJSON(),
      new SlashCommandBuilder().setName('stop').setDescription('Para a música e desconecta').toJSON(),
      new SlashCommandBuilder().setName('pause').setDescription('Pausa a música atual').toJSON(),
      new SlashCommandBuilder().setName('resume').setDescription('Retoma a música pausada').toJSON(),
      new SlashCommandBuilder().setName('queue').setDescription('Mostra a fila de músicas').toJSON(),
      new SlashCommandBuilder().setName('nowplaying').setDescription('Mostra a música atual').toJSON(),
      new SlashCommandBuilder().setName('status').setDescription('Mostra os clones livres ou ocupados').toJSON(),
      new SlashCommandBuilder().setName('volume').setDescription('Ajusta o volume (0-100)').addIntegerOption((o) => o.setName('nivel').setDescription('Volume 0-100').setRequired(true).setMinValue(0).setMaxValue(100)).toJSON(),

      new SlashCommandBuilder().setName('setup').setDescription('Define o canal de comandos deste servidor')
        .addChannelOption((o) => o.setName('canal').setDescription('Canal de texto').addChannelTypes(ChannelType.GuildText).setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
      new SlashCommandBuilder().setName('unsetup').setDescription('Remove a restrição de canal')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator).toJSON(),
    ];
    const rest = new REST({ version: '10' }).setToken(process.env.BOT_MAIN_TOKEN);
    try {
      await rest.put(Routes.applicationCommands(process.env.MAIN_CLIENT_ID), { body: commands });
      console.log('[Manager] ✅ Comandos registados.');
    } catch (err) {
      console.error('[Manager] Falha ao registar comandos:', err?.message || err);
    }
  };

  const spawnWorker = (bot) => {
    const worker = cluster.fork({ BOT_NAME: bot.name, BOT_DISPLAY_NAME: bot.displayName, DISCORD_TOKEN: process.env[bot.tokenEnv] });
    worker.customBotName = bot.name;
    workersByName.set(bot.name, worker);
    worker.on('message', (msg) => handleWorkerMessage(bot.name, msg));
  };

  for (const bot of BOTS) {
    if (!process.env[bot.tokenEnv]) continue;
    spawnWorker(bot);
  }

  cluster.on('exit', (worker) => {
    const name = worker.customBotName;
    if (name) markFree(name);
    const bot = BOTS.find((b) => b.name === name);
    if (bot) setTimeout(() => spawnWorker(bot), 5000);
  });

  registerCommands();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates
    ]
  });

  const dispatch = (msg) => handleWorkerMessage('MAIN', msg);

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      const { guildId, token: interactionToken } = interaction;
      const applicationId = client.application.id;

      if (interaction.isButton()) {
        if (interaction.customId === 'music:favorite') {
          await interaction.deferReply({ flags: 64 });
          return dispatch({ type: 'request_favorite_toggle', guildId, panelMessageId: interaction.message.id, userId: interaction.user.id, interactionToken, applicationId });
        }
        if (interaction.customId === 'music:play') {
          const modal = new ModalBuilder().setCustomId(`music:play_modal:${interaction.message.id}:${interaction.channelId}`).setTitle('Adicionar música');
          modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('query').setLabel('Música ou link').setStyle(TextInputStyle.Short).setRequired(true)));
          return interaction.showModal(modal);
        }
        const action = { 'music:toggle_pause': 'toggle_pause', 'music:skip': 'skip', 'music:queue': 'queue', 'music:stop': 'stop' }[interaction.customId];
        if (!action) return;
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) return interaction.reply({ content: 'Entra num canal de voz primeiro.', flags: 64 });
        await interaction.deferUpdate();
        return dispatch({ type: 'request_control', action, args: {}, guildId, voiceChannelId: voiceChannel.id, interactionToken, applicationId });
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('music:play_modal:')) {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) return interaction.reply({ content: 'Entra num canal de voz primeiro.', flags: 64 });
        const [, , panelMessageId, panelChannelId] = interaction.customId.split(':');
        const query = cleanUrl(interaction.fields.getTextInputValue('query'));
        await interaction.deferReply({ flags: 64 });
        return dispatch({ type: 'request_play', query, guildId, voiceChannelId: voiceChannel.id, textChannelId: interaction.channelId, requesterId: interaction.user.id, requesterName: interaction.user.username, interactionToken, applicationId, panelMessageId, panelChannelId });
      }

      if (interaction.isChatInputCommand()) {
        const cmd = interaction.commandName;

        if (cmd === 'setup' || cmd === 'unsetup') {
          if (!interaction.memberPermissions.has(PermissionFlagsBits.Administrator)) {
            return interaction.reply({ content: '❌ Apenas administradores (Administrator) podem usar este comando.', flags: 64 });
          }

          if (cmd === 'setup') {
            const channel = interaction.options.getChannel('canal');
            setCommandChannel(guildId, channel.id);
            return interaction.reply({ content: `✅ Canal de comandos definido para <#${channel.id}>.`, flags: 64 });
          }

          if (cmd === 'unsetup') {
            unsetCommandChannel(guildId);
            return interaction.reply({ content: '✅ Restrição de canal removida.', flags: 64 });
          }
        }

        if (cmd === 'status') { await interaction.deferReply(); return dispatch({ type: 'status_request', guildId, interactionToken, applicationId }); }
        if (cmd === 'play') {
          const query = cleanUrl(interaction.options.getString('query'));
          const voiceChannel = interaction.member?.voice?.channel;
          if (!voiceChannel) return interaction.reply({ content: '❌ Entra num canal de voz primeiro.', flags: 64 });
          await interaction.deferReply();
          const panelMessage = await interaction.editReply({ content: 'A carregar player Lavalink...' });
          return dispatch({ type: 'request_play', query, guildId, voiceChannelId: voiceChannel.id, textChannelId: interaction.channelId, requesterId: interaction.user.id, requesterName: interaction.user.username, interactionToken, applicationId, panelMessageId: panelMessage.id, panelChannelId: interaction.channelId, panelReply: true });
        }
        if (['skip', 'stop', 'pause', 'resume', 'queue', 'nowplaying', 'volume'].includes(cmd)) {
          const voiceChannel = interaction.member?.voice?.channel;
          if (!voiceChannel) return interaction.reply({ content: '❌ Entra num canal de voz.', flags: 64 });
          await interaction.deferReply();
          const args = cmd === 'volume' ? { level: interaction.options.getInteger('nivel') } : {};
          return dispatch({ type: 'request_control', action: cmd, args, guildId, voiceChannelId: voiceChannel.id, interactionToken, applicationId });
        }
      }
    } catch (e) {
      console.error('[Interaction] Erro ao processar interação:', e?.message || e);
    }
  });
  client.login(process.env.BOT_MAIN_TOKEN);

} else {

  const { Client, Events, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const { Shoukaku, Connectors } = require('shoukaku');

  const BOT_NAME = process.env.BOT_NAME;
  const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME || BOT_NAME;
  const TOKEN = process.env.DISCORD_TOKEN;

  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
  });

  const Nodes = [{
    name: 'DiscloudNode',
    url: 'lavalinkrefugio.discloud.dev:443',
    auth: process.env.LAVALINK_PASSWORD,
    secure: true,
  }];

  const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes);
  const activeQueues = new Map();

  shoukaku.on('ready', (name) => console.log(`[${BOT_DISPLAY_NAME}] Lavalink conectado (${name}).`));
  shoukaku.on('error', (_, error) => console.error(`[${BOT_DISPLAY_NAME}] Erro no Shoukaku:`, error));
  shoukaku.on('close', (name, code, reason) => console.warn(`[${BOT_DISPLAY_NAME}] Lavalink fechou (${name}): ${code}${reason || ''}`));
  shoukaku.on('disconnect', (name) => console.warn(`[${BOT_DISPLAY_NAME}] Lavalink desconectado (${name}).`));

  client.once(Events.ClientReady, () => process.send?.({ type: 'ready', name: BOT_NAME }));

  const formatDuration = (ms) => {
    if (!ms || ms === 0) return '0:00';
    const s = Math.floor((ms / 1000) % 60), m = Math.floor((ms / 60000) % 60), h = Math.floor(ms / 3600000);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };

  const createProgressBar = (current, total, length = 15) => {
    if (total === 0) return '🔘' + '▬'.repeat(length - 1);
    const index = Math.round((current / total) * length);
    const bar = '▬'.repeat(Math.max(0, index)) + '🔘' + '▬'.repeat(Math.max(0, length - index - 1));
    return bar;
  };

  const buildPanel = (queue = null) => {
    const track = queue?.currentTrack;
    const isPaused = Boolean(queue?.player?.paused);
    
    if (!track) {
      const emptyEmbed = new EmbedBuilder()
        .setColor(0x2b2d31)
        .setTitle('📻 O teu player de música')
        .setDescription('Nenhuma música na fila. Usa um comando para começar!');
      return { content: '', embeds: [emptyEmbed.toJSON()], components: [] };
    }

    const currentPos = queue.player.position || 0;
    const totalLen = track.durationMS || 0;
    const progress = createProgressBar(currentPos, totalLen, 20);
    
    const nextTracks = queue.tracks.length > 0 
      ? queue.tracks.slice(0, 3).map((t, i) => {
          const shortTitle = t.title.length > 45 ? t.title.substring(0, 45) + '...' : t.title;
          return `\`${i + 1}.\` **${shortTitle}**`;
        }).join('\n') 
      : 'Nenhuma música na fila.';
      
    const queueCount = queue.tracks.length > 3 ? `\n*e mais ${queue.tracks.length - 3} música(s)...*` : '';

    const embed = new EmbedBuilder()
      .setColor(isPaused ? 0xf1c40f : 0x5865f2)
      .setAuthor({ name: isPaused ? '⏸️ Pausado' : '▶️ A tocar agora' })
      .setTitle(track.title)
      .setURL(track.url)
      .setDescription(`👤 **Autor:** ${track.author}\n\n${progress}\n\`${formatDuration(currentPos)} / ${formatDuration(totalLen)}\``)
      .addFields(
        { name: '🎙️ Canal', value: `<#${queue.metadata.voiceChannelId}>`, inline: true },
        { name: '🎧 Pedida por', value: track.requesterName || 'Desconhecido', inline: true },
        { name: '🤖 Clone', value: BOT_DISPLAY_NAME, inline: true },
        { name: '📑 Próximas na fila', value: `${nextTracks}${queueCount}`, inline: false }
      );

    if (track.thumbnail) embed.setThumbnail(track.thumbnail);

    const components = [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music:play').setLabel('Adicionar').setEmoji('➕').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('music:toggle_pause').setLabel(isPaused ? 'Retomar' : 'Pausar').setEmoji(isPaused ? '▶️' : '⏸️').setStyle(isPaused ? ButtonStyle.Success : ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('music:skip').setLabel('Pular').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('music:stop').setLabel('Parar').setEmoji('⏹️').setStyle(ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('music:favorite').setLabel('Favoritar Música').setEmoji('⭐').setStyle(ButtonStyle.Secondary),
      )
    ];
    
    return { content: '', embeds: [embed.toJSON()], components: components.map(c => c.toJSON()) };
  };

  const leaveVoice = async (guildId) => {
    const queue = activeQueues.get(guildId);
    if (queue && queue.updateInterval) clearInterval(queue.updateInterval);
    activeQueues.delete(guildId);
    try { await shoukaku.leaveVoiceChannel(guildId); } catch {}
  };

  const playNext = async (queue) => {
    if (activeQueues.get(queue.metadata.guildId) !== queue) return;

    queue.currentTrack = queue.tracks.shift();
    if (!queue.currentTrack) {
      await leaveVoice(queue.metadata.guildId);
      process.send?.({ type: 'bot_freed', name: BOT_NAME });
      return;
    }
    try {
      await queue.player.playTrack({ track: { encoded: queue.currentTrack.encoded } });
      if (queue.metadata.panelMessageId) {
          process.send?.({ type: 'control_result', interactionToken: queue.metadata.interactionToken, applicationId: queue.metadata.applicationId, payload: buildPanel(queue) });
      }
    } catch (err) {
      queue.currentTrack = null;
      throw err;
    }
  };

  process.on('message', async (msg) => {
    if (msg.type === 'execute_play') {
      try {
        const node = shoukaku.options.nodeResolver(shoukaku.nodes);
        if (!node) throw new Error('Servidor Lavalink offline.');

        const searchQuery = /^https?:\/\//i.test(msg.query) ? msg.query : `ytsearch:${msg.query}`;
        const result = await node.rest.resolve(searchQuery);

        if (!result || result.loadType === 'empty' || result.loadType === 'error') {
          throw new Error('Não consegui encontrar a música. Tenta de novo colocando somente o título da música.');
        }

        const tracksToAdd = result.loadType === 'playlist'
          ? result.data.tracks
          : [Array.isArray(result.data) ? result.data[0] : result.data];

        const mapped = tracksToAdd
          .filter((t) => t?.encoded && t?.info)
          .map((t) => ({ 
            encoded: t.encoded, 
            title: t.info.title, 
            url: t.info.uri, 
            durationMS: t.info.length, 
            author: t.info.author,
            thumbnail: t.info.artworkUrl || (t.info.identifier ? `https://img.youtube.com/vi/${t.info.identifier}/hqdefault.jpg` : null),
            requesterName: msg.requesterName
          }));
          
        if (!mapped.length) throw new Error('Não consegui encontrar a música. Tenta de novo colocando somente o título da música.');

        let queue = activeQueues.get(msg.guildId);
        if (!queue) {
          const player = await shoukaku.joinVoiceChannel({ guildId: msg.guildId, channelId: msg.voiceChannelId, shardId: 0, deaf: true });
          
          queue = { 
            player, 
            tracks: [], 
            currentTrack: null, 
            metadata: { 
              guildId: msg.guildId, 
              voiceChannelId: msg.voiceChannelId, 
              interactionToken: msg.interactionToken, 
              applicationId: msg.applicationId,
              panelMessageId: msg.panelMessageId
            } 
          };

          player.on('end', (data) => {
            if (data.reason !== 'replaced') {
              playNext(queue).catch((err) => console.error(`[${BOT_DISPLAY_NAME}] Erro ao avançar a fila:`, err?.message || err));
            }
          });
          player.on('exception', (data) => console.error(`[${BOT_DISPLAY_NAME}] Erro ao tocar:`, data?.exception?.message || data));

          queue.updateInterval = setInterval(() => {
            if (queue.currentTrack && !queue.player.paused && queue.metadata.panelMessageId) {
               process.send?.({ type: 'control_result', interactionToken: queue.metadata.interactionToken, applicationId: queue.metadata.applicationId, payload: buildPanel(queue) });
            }
          }, 10000);

          activeQueues.set(msg.guildId, queue);
        } else {
          if (msg.panelMessageId) {
            queue.metadata.interactionToken = msg.interactionToken;
            queue.metadata.applicationId = msg.applicationId;
            queue.metadata.panelMessageId = msg.panelMessageId;
          }
        }

        queue.tracks.push(...mapped);
        if (!queue.currentTrack) await playNext(queue);

        process.send?.({ type: 'play_started', assignedBot: BOT_DISPLAY_NAME, interactionToken: msg.interactionToken, applicationId: msg.applicationId, trackTitle: mapped[0].title, panelReply: msg.panelReply });

        if (msg.panelMessageId) {
          process.send?.({ type: 'control_result', interactionToken: msg.interactionToken, applicationId: msg.applicationId, payload: buildPanel(queue) });
        }
      } catch (err) {
        console.error(`[${BOT_DISPLAY_NAME}] Falha ao tocar:`, err?.message || err);

        const queue = activeQueues.get(msg.guildId);
        if (!queue || !queue.currentTrack) {
          if (queue) await leaveVoice(msg.guildId);
          process.send?.({ type: 'bot_freed', name: BOT_NAME });
        }

        process.send?.({ type: 'play_failed', interactionToken: msg.interactionToken, applicationId: msg.applicationId, error: `❌ ${err?.message || 'Erro desconhecido.'}` });
      }
    }

    if (msg.type === 'execute_favorite_toggle') {
      const queue = activeQueues.get(msg.guildId);
      const track = queue?.currentTrack;
      if (!track) return process.send?.({ type: 'favorite_toggle_error', interactionToken: msg.interactionToken, applicationId: msg.applicationId, content: 'Nada a tocar no momento.' });
      process.send?.({ type: 'favorite_toggle', userId: msg.userId, interactionToken: msg.interactionToken, applicationId: msg.applicationId, track });
    }

    if (msg.type === 'execute_control') {
      const queue = activeQueues.get(msg.guildId);
      if (!queue) return process.send?.({ type: 'control_result', interactionToken: msg.interactionToken, applicationId: msg.applicationId, payload: 'Nada a tocar no momento.' });

      try {
        if (msg.action === 'skip') await queue.player.stopTrack();
        if (msg.action === 'stop') {
          queue.tracks = [];
          queue.currentTrack = null;
          await leaveVoice(msg.guildId);
          process.send?.({ type: 'bot_freed', name: BOT_NAME });
        }
        if (msg.action === 'toggle_pause') await queue.player.setPaused(!queue.player.paused);
        if (msg.action === 'pause') await queue.player.setPaused(true);
        if (msg.action === 'resume') await queue.player.setPaused(false);
        if (msg.action === 'volume') await queue.player.setGlobalVolume(msg.args?.level ?? 100);

        process.send?.({ type: 'control_result', interactionToken: msg.interactionToken, applicationId: msg.applicationId, payload: buildPanel(queue) });
      } catch (err) {
        console.error(`[${BOT_DISPLAY_NAME}] Erro no controlo:`, err?.message || err);
        process.send?.({ type: 'control_result', interactionToken: msg.interactionToken, applicationId: msg.applicationId, payload: `❌ ${err?.message || 'Erro desconhecido.'}` });
      }
    }
  });

  client.login(TOKEN);
}