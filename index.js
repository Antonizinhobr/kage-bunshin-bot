require('dotenv').config();
const cluster = require('cluster');
const fs = require('fs');
const path = require('path');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

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

// ═════════════════════════════════════════════════════════════════════
//  VISUAL — cores e helpers de embed usados pelo manager e pelos clones.
//  Para mudar o tema do bot inteiro, basta trocar as cores do THEME.
// ═════════════════════════════════════════════════════════════════════
const THEME = {
  playing:  0xFF7A00, // laranja  — tocando
  paused:   0x5865F2, // azul     — pausado
  success:  0x57F287, // verde    — confirmações
  error:    0xED4245, // vermelho — erros
  warn:     0xFEE75C, // amarelo  — avisos
  favorite: 0xFFC83D, // dourado  — favoritas
  idle:     0x4E5058, // cinza    — player encerrado
};

const NOTICE_STYLE = {
  success: { color: THEME.success, emoji: '✅' },
  error:   { color: THEME.error,   emoji: '❌' },
  warn:    { color: THEME.warn,    emoji: '⚠️' },
  info:    { color: THEME.paused,  emoji: '💬' },
};

const cut = (text, max) => {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};
const esc = (text) => String(text ?? '').replace(/([\\*_~`|>[\]])/g, '\\$1');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isHttp = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

const toPayload = (embeds, rows = []) => ({
  content: '',
  embeds: [].concat(embeds).map((e) => e.toJSON()),
  components: rows.map((r) => r.toJSON()),
});

const notice = (kind, text, { title, emoji } = {}) => {
  const style = NOTICE_STYLE[kind] || NOTICE_STYLE.info;
  const icon = emoji ?? style.emoji;
  const body = title ? `**${icon} ${title}**\n${text}` : `${icon} ${text}`;
  return toPayload(new EmbedBuilder().setColor(style.color).setDescription(body));
};

const button = (customId, { label, emoji, style = ButtonStyle.Secondary, disabled = false } = {}) => {
  const b = new ButtonBuilder().setCustomId(customId).setStyle(style).setDisabled(disabled);
  if (label) b.setLabel(label);
  if (emoji) b.setEmoji(emoji);
  return b;
};
const row = (...buttons) => new ActionRowBuilder().addComponents(...buttons);

if (cluster.isPrimary) {

  const { REST, Routes, SlashCommandBuilder, ChannelType, PermissionFlagsBits, Client, Events, ModalBuilder, TextInputBuilder, TextInputStyle, GatewayIntentBits } = require('discord.js');

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
  const deletedPanels = new Set();
  const noAccessPanels = new Set();
  const expiredTokens = new Set();
  const displayName = (internalName) => BOTS.find((b) => b.name === internalName)?.displayName || internalName;

  const registerBot = (name) => { if (!botStates.has(name)) botStates.set(name, { name, busy: false, guildId: null, channelId: null }); };
  const getFreeBot = () => { for (const [name, s] of botStates) if (!s.busy) return name; return null; };
  const markBusy = (name, guildId, channelId) => { const s = botStates.get(name); if (s) { s.busy = true; s.guildId = guildId; s.channelId = channelId; } };
  const markFree = (name) => { const s = botStates.get(name); if (s) { s.busy = false; s.guildId = null; s.channelId = null; } };
  const findBotInChannel = (guildId, channelId) => { for (const [name, s] of botStates) { if (s.busy && s.guildId === guildId && s.channelId === channelId) return name; } return null; };

  // Clone para /player, /fila e botão Fila: o do teu canal de voz ou, se só houver um no servidor, esse.
  const findBotForView = (guildId, voiceChannelId) => {
    const here = voiceChannelId ? findBotInChannel(guildId, voiceChannelId) : null;
    if (here) return { bot: here, count: 1 };
    const inGuild = [...botStates.values()].filter((s) => s.busy && s.guildId === guildId);
    return { bot: inGuild.length === 1 ? inGuild[0].name : null, count: inGuild.length };
  };

  // ── Embeds do manager ────────────────────────────────────────────
  const voiceRequired = () => notice('warn', 'Entre em um canal de voz primeiro.', { emoji: '🎧' });
  const wrongChannel = (channelId) => notice('warn', `Os comandos de música só funcionam em <#${channelId}>.`, { emoji: '📍' });
  const allBusy = () => notice('error', 'Todos os clones estão ocupados agora. Tente de novo em instantes.\nUse `/status` para ver quem está livre.', { title: 'Sem clones livres', emoji: '🥷' });
  const nothingPlaying = () => notice('info', 'Nada tocando agora. Use `/play` para chamar um clone.', { emoji: '📭' });

  const loadingPayload = (text, footer) => toPayload(
    new EmbedBuilder().setColor(THEME.playing).setDescription(text).setFooter({ text: footer })
  );

  const favoritePayload = (track, added, total) => {
    const title = isHttp(track.url) ? `[${esc(cut(track.title, 80))}](${track.url})` : `**${esc(cut(track.title, 80))}**`;
    const embed = new EmbedBuilder()
      .setColor(added ? THEME.favorite : THEME.idle)
      .setDescription(added ? `⭐ ${title}\nfoi salva nas suas favoritas.` : `☆ ${title}\nfoi removida das suas favoritas.`)
      .setFooter({ text: `Você tem ${plural(total, 'música favorita', 'músicas favoritas')}` });
    if (added && isHttp(track.thumbnail)) embed.setThumbnail(track.thumbnail);
    return toPayload(embed);
  };

  const buildStatusPayload = (guildId) => {
    const active = BOTS.filter((b) => process.env[b.tokenEnv]);
    let free = 0;
    const lines = active.map((b) => {
      const s = botStates.get(b.name);
      if (!s) return `⚫ **${b.displayName}** — iniciando…`;
      if (!s.busy) { free += 1; return `🟢 **${b.displayName}** — livre`; }
      if (s.guildId === guildId) return `🔴 **${b.displayName}** — tocando em <#${s.channelId}>`;
      return `🟠 **${b.displayName}** — ocupado em outro servidor`;
    });
    const embed = new EmbedBuilder()
      .setColor(free > 0 ? THEME.success : THEME.error)
      .setAuthor({ name: 'Status dos clones', iconURL: client.user?.displayAvatarURL({ size: 64 }) || undefined })
      .setDescription(lines.join('\n') || 'Nenhum clone configurado.')
      .setFooter({ text: free > 0 ? `${free} de ${active.length} livres • use /play para chamar um` : 'Todos ocupados • tente de novo em instantes' });
    return toPayload(embed);
  };

  // Mesmas checagens do request_play, feitas antes de responder para o erro sair só para quem usou.
  const precheckPlay = (guildId, textChannelId, voiceChannelId) => {
    const allowedChannel = getCommandChannel(guildId);
    if (allowedChannel && textChannelId !== allowedChannel) return wrongChannel(allowedChannel);
    if (!findBotInChannel(guildId, voiceChannelId) && !getFreeBot()) return allBusy();
    return null;
  };

  // Se o "Adicionar" veio do painel ativo de OUTRO clone, o novo clone não pode assumir esse painel.
  const withPanelGuard = (msg, targetBot) => {
    if (msg.panelReply || !msg.panelMessageId) return msg;
    const owner = panelOwners.get(`${msg.guildId}:${msg.panelMessageId}`);
    const ownerState = owner ? botStates.get(owner) : null;
    if (owner && owner !== targetBot && ownerState?.busy && ownerState.guildId === msg.guildId) {
      return { ...msg, panelMessageId: null, panelChannelId: null };
    }
    return msg;
  };

  const editInteractionReply = async (applicationId, interactionToken, payload) => {
    try {
      const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
      await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(typeof payload === 'string' ? { content: payload } : payload) }).catch(() => null);
    } catch (e) {}
  };

  const followUpInteraction = async (applicationId, interactionToken, payload) => {
    try {
      const { content, ...rest } = typeof payload === 'string' ? { content: payload } : payload;
      const body = content ? { content, ...rest, flags: 64 } : { ...rest, flags: 64 };
      const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}`;
      await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    } catch (e) {}
  };

  // O painel é editado pelo token do bot (não expira). O token da interação (15 min) fica de reserva.
  const editPanel = async (msg) => {
    const key = `${msg.channelId}:${msg.messageId}`;
    if (!msg.messageId || deletedPanels.has(key)) return;
    if (msg.channelId && !noAccessPanels.has(key)) {
      try {
        await client.rest.patch(Routes.channelMessage(msg.channelId, msg.messageId), { body: msg.payload });
        return;
      } catch (err) {
        if (err?.code === 10008) { deletedPanels.add(key); return; }                   // mensagem apagada
        if (err?.code === 50001 || err?.code === 50013) noAccessPanels.add(key);        // bot sem acesso ao canal
      }
    }
    if (!msg.interactionToken || expiredTokens.has(msg.interactionToken)) return;
    try {
      const url = `https://discord.com/api/v10/webhooks/${msg.applicationId}/${msg.interactionToken}/messages/@original`;
      const res = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg.payload) });
      if (res?.status === 401 || res?.status === 404) expiredTokens.add(msg.interactionToken);
    } catch (e) {}
  };

  const sendToBot = (name, msg) => { const w = workersByName.get(name); if (w) w.send(msg); };

  const handleWorkerMessage = (fromBot, msg) => {
    if (msg.type === 'ready') { registerBot(msg.name); console.log(`[Manager] ${displayName(msg.name)} pronto.`); return; }
    if (msg.type === 'bot_freed') {
      markFree(msg.name);
      for (const [key, owner] of panelOwners) if (owner === msg.name) panelOwners.delete(key);
      console.log(`[Manager] ${displayName(msg.name)} libertado.`);
      return;
    }
    if (msg.type === 'request_play') {
      const allowedChannel = getCommandChannel(msg.guildId);
      if (allowedChannel && msg.textChannelId !== allowedChannel) return editInteractionReply(msg.applicationId, msg.interactionToken, wrongChannel(allowedChannel));

      const existingBot = findBotInChannel(msg.guildId, msg.voiceChannelId);
      if (existingBot) {
        return sendToBot(existingBot, { ...withPanelGuard(msg, existingBot), type: 'execute_play' });
      }

      const freeBot = getFreeBot();
      if (!freeBot) return editInteractionReply(msg.applicationId, msg.interactionToken, allBusy());

      markBusy(freeBot, msg.guildId, msg.voiceChannelId);
      sendToBot(freeBot, { ...withPanelGuard(msg, freeBot), type: 'execute_play' });
      return;
    }
    if (msg.type === 'panel_update') {
      if (msg.guildId && msg.messageId) panelOwners.set(`${msg.guildId}:${msg.messageId}`, fromBot);
      return editPanel(msg);
    }
    if (msg.type === 'favorite_toggle') {
      const userId = String(msg.userId || '');
      if (!favoritesStore.users[userId]) favoritesStore.users[userId] = [];
      const list = favoritesStore.users[userId];
      const track = msg.track;
      const favoriteKey = track.url || track.title.toLowerCase();
      const index = list.findIndex((item) => item.key === favoriteKey);
      if (index >= 0) { list.splice(index, 1); editInteractionReply(msg.applicationId, msg.interactionToken, favoritePayload(track, false, list.length)); }
      else { list.push({ key: favoriteKey, ...track, addedAt: new Date().toISOString() }); editInteractionReply(msg.applicationId, msg.interactionToken, favoritePayload(track, true, list.length)); }
      return saveFavorites();
    }
    if (msg.type === 'play_started') {
      if (!msg.panelReply) editInteractionReply(msg.applicationId, msg.interactionToken, msg.payload || notice('success', `**${msg.assignedBot}** tocando **${esc(msg.trackTitle)}**`));
      return;
    }
    if (msg.type === 'play_failed' || msg.type === 'favorite_toggle_error') {
      return editInteractionReply(msg.applicationId, msg.interactionToken, msg.payload || notice('error', msg.error || msg.content));
    }
    if (msg.type === 'control_result') return editInteractionReply(msg.applicationId, msg.interactionToken, msg.payload || msg.content);
    if (msg.type === 'interaction_followup') return followUpInteraction(msg.applicationId, msg.interactionToken, msg.payload || msg.content);
  };

  const registerCommands = async () => {
    const commands = [
      new SlashCommandBuilder().setName('play').setDescription('Toca uma música ou playlist (nome ou link)')
        .addStringOption((o) => o.setName('musica').setDescription('Nome da música ou link').setRequired(true)).toJSON(),
      new SlashCommandBuilder().setName('player').setDescription('Mostra o painel da música atual com todos os controles').toJSON(),
      new SlashCommandBuilder().setName('fila').setDescription('Mostra a fila completa, com páginas').toJSON(),
      new SlashCommandBuilder().setName('volume').setDescription('Ajusta o volume (0 a 100)')
        .addIntegerOption((o) => o.setName('nivel').setDescription('Volume de 0 a 100').setRequired(true).setMinValue(0).setMaxValue(100)).toJSON(),
      new SlashCommandBuilder().setName('status').setDescription('Mostra quais clones estão livres ou ocupados').toJSON(),
      new SlashCommandBuilder().setName('config').setDescription('Configurações do bot neste servidor')
        .addSubcommand((s) => s.setName('canal').setDescription('Define o único canal onde o /play pode ser usado')
          .addChannelOption((o) => o.setName('canal').setDescription('Canal de texto').addChannelTypes(ChannelType.GuildText).setRequired(true)))
        .addSubcommand((s) => s.setName('remover').setDescription('Libera o /play em qualquer canal'))
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
  const PANEL_CONTROLS = new Set(['toggle_pause', 'skip', 'stop', 'vol_down', 'vol_up']);

  client.on(Events.InteractionCreate, async (interaction) => {
    try {
      const { guildId, token: interactionToken } = interaction;
      const applicationId = client.application.id;
      const voiceChannel = interaction.member?.voice?.channel || null;
      const who = {
        userId: interaction.user.id,
        userName: interaction.member?.displayName || interaction.user.globalName || interaction.user.username,
        userAvatar: interaction.user.displayAvatarURL({ size: 64 }),
      };
      const ephemeral = (payload) => interaction.reply({ ...payload, flags: 64 });

      if (interaction.isButton()) {
        const [scope, action, owner] = interaction.customId.split(':');

        // Paginação da fila — fila:<clone>:<página>:<tag>
        if (scope === 'fila') {
          const [, botName, page] = interaction.customId.split(':');
          if (!workersByName.has(botName)) return ephemeral(notice('error', 'Este clone não está mais disponível.'));
          await interaction.deferUpdate();
          return sendToBot(botName, { type: 'execute_view', view: 'queue', page: Math.max(0, Number(page) || 0), guildId, interactionToken, applicationId });
        }
        if (scope !== 'music') return;

        if (action === 'play') {
          const modal = new ModalBuilder().setCustomId(`music:play_modal:${interaction.message.id}:${interaction.channelId}`).setTitle('➕ Adicionar música');
          modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId('query').setLabel('Nome ou link da música').setPlaceholder('Ex.: Skillet - Monster  ou  https://youtu.be/...').setStyle(TextInputStyle.Short).setRequired(true)
          ));
          return interaction.showModal(modal);
        }

        if (action === 'favorite' || action === 'queue') {
          const target = (owner && workersByName.has(owner) ? owner : null)
            || panelOwners.get(`${guildId}:${interaction.message.id}`)
            || findBotForView(guildId, voiceChannel?.id).bot;
          if (!target) return ephemeral(notice('info', 'Não há reprodução ativa para este painel.', { emoji: '📭' }));
          await interaction.deferReply({ flags: 64 });
          if (action === 'queue') return sendToBot(target, { type: 'execute_view', view: 'queue', page: 0, guildId, interactionToken, applicationId });
          return sendToBot(target, { type: 'execute_favorite_toggle', guildId, userId: who.userId, interactionToken, applicationId });
        }

        if (!PANEL_CONTROLS.has(action)) return;
        if (!voiceChannel) return ephemeral(voiceRequired());
        const target = findBotInChannel(guildId, voiceChannel.id);
        if (!target) return ephemeral(notice('warn', 'Nenhum clone está tocando no seu canal de voz.', { emoji: '🔇' }));
        const ownerState = owner ? botStates.get(owner) : null;
        if (owner && owner !== target && ownerState?.busy && ownerState.guildId === guildId) {
          return ephemeral(notice('warn', `Este painel é do **${displayName(owner)}**, que está em <#${ownerState.channelId}>. Entre nesse canal para controlar.`));
        }
        await interaction.deferUpdate();
        return sendToBot(target, { type: 'execute_control', action, args: {}, guildId, ...who, interactionToken, applicationId, deferred: 'update', panelMessageId: interaction.message.id, panelChannelId: interaction.channelId });
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('music:play_modal:')) {
        if (!voiceChannel) return ephemeral(voiceRequired());
        const [, , panelMessageId, panelChannelId] = interaction.customId.split(':');
        const query = cleanUrl(interaction.fields.getTextInputValue('query'));
        const blocked = precheckPlay(guildId, interaction.channelId, voiceChannel.id);
        if (blocked) return ephemeral(blocked);
        await interaction.deferReply({ flags: 64 });
        return dispatch({ type: 'request_play', query, guildId, voiceChannelId: voiceChannel.id, textChannelId: interaction.channelId, requesterId: interaction.user.id, requesterName: interaction.user.username, ...who, interactionToken, applicationId, panelMessageId, panelChannelId });
      }

      if (interaction.isChatInputCommand()) {
        const cmd = interaction.commandName;

        if (cmd === 'config') {
          if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
            return ephemeral(notice('error', 'Apenas administradores podem usar este comando.', { emoji: '🔒' }));
          }
          const sub = interaction.options.getSubcommand();
          if (sub === 'canal') {
            const channel = interaction.options.getChannel('canal');
            setCommandChannel(guildId, channel.id);
            return ephemeral(notice('success', `A partir de agora o \`/play\` só funciona em <#${channel.id}>.`, { title: 'Canal de música definido' }));
          }
          if (sub === 'remover') {
            unsetCommandChannel(guildId);
            return ephemeral(notice('success', 'O `/play` voltou a funcionar em qualquer canal.', { title: 'Restrição removida' }));
          }
          return;
        }

        if (cmd === 'status') return interaction.reply(buildStatusPayload(guildId));

        if (cmd === 'play') {
          const query = cleanUrl(interaction.options.getString('musica'));
          if (!voiceChannel) return ephemeral(voiceRequired());
          const blocked = precheckPlay(guildId, interaction.channelId, voiceChannel.id);
          if (blocked) return ephemeral(blocked);
          await interaction.deferReply();
          const panelMessage = await interaction.editReply(loadingPayload(`🔎 Procurando **${esc(cut(query, 150))}**…`, 'Chamando um clone livre…'));
          return dispatch({ type: 'request_play', query, guildId, voiceChannelId: voiceChannel.id, textChannelId: interaction.channelId, requesterId: interaction.user.id, requesterName: interaction.user.username, ...who, interactionToken, applicationId, panelMessageId: panelMessage.id, panelChannelId: interaction.channelId, panelReply: true });
        }

        if (cmd === 'player' || cmd === 'fila') {
          const { bot, count } = findBotForView(guildId, voiceChannel?.id);
          if (!bot) {
            return ephemeral(count > 1
              ? notice('info', `Há ${count} clones tocando agora. Entre no canal de voz de um deles e tente de novo.`, { emoji: '🥷' })
              : nothingPlaying());
          }
          await interaction.deferReply();
          if (cmd === 'fila') return sendToBot(bot, { type: 'execute_view', view: 'queue', page: 0, guildId, interactionToken, applicationId });
          const panelMessage = await interaction.editReply(loadingPayload('🎛️ Abrindo o painel…', displayName(bot)));
          return sendToBot(bot, { type: 'execute_view', view: 'player', guildId, interactionToken, applicationId, panelMessageId: panelMessage.id, panelChannelId: interaction.channelId });
        }

        if (cmd === 'volume') {
          if (!voiceChannel) return ephemeral(voiceRequired());
          const bot = findBotInChannel(guildId, voiceChannel.id);
          if (!bot) return ephemeral(notice('warn', 'Nenhum clone está tocando no seu canal de voz.', { emoji: '🔇' }));
          await interaction.deferReply();
          return sendToBot(bot, { type: 'execute_control', action: 'volume', args: { level: interaction.options.getInteger('nivel') }, guildId, ...who, interactionToken, applicationId });
        }
      }
    } catch (e) {
      console.error('[Interaction] Erro ao processar interação:', e?.message || e);
    }
  });
  client.login(process.env.BOT_MAIN_TOKEN);

} else {

  const { Client, Events, GatewayIntentBits } = require('discord.js');
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

  // ── Formatação ───────────────────────────────────────────────────
  const formatDuration = (ms) => {
    if (!ms || ms === 0) return '0:00';
    const s = Math.floor((ms / 1000) % 60), m = Math.floor((ms / 60000) % 60), h = Math.floor(ms / 3600000);
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  };

  const formatLong = (ms) => {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}min`;
    if (m > 0) return `${m}min`;
    return `${s}s`;
  };

  const isLive = (t) => Number(t?.durationMS) >= Number.MAX_SAFE_INTEGER;
  const lengthOf = (t) => (isLive(t) ? 'AO VIVO' : formatDuration(t?.durationMS));
  const sumDuration = (tracks) => tracks.reduce((acc, t) => acc + (isLive(t) ? 0 : (t.durationMS || 0)), 0);

  const progressBar = (current, total, size = 16) => {
    const filled = total > 0 ? Math.max(0, Math.min(size, Math.round((current / total) * size))) : 0;
    return '▰'.repeat(filled) + '▱'.repeat(size - filled);
  };

  const trackLink = (t, max = 60) => {
    const title = esc(cut(t?.title || 'Sem título', max));
    return isHttp(t?.url) ? `[${title}](${t.url.replace(/\)/g, '%29')})` : `**${title}**`;
  };
  const requesterOf = (t) => (t?.requesterId ? `<@${t.requesterId}>` : esc(t?.requesterName || 'Desconhecido'));
  const cloneIcon = () => client.user?.displayAvatarURL({ size: 64 }) || undefined;
  const ctrlId = (action) => `music:${action}:${BOT_NAME}`;
  const setLastAction = (queue, text, avatar) => { queue.lastAction = { text: cut(text, 180), icon: isHttp(avatar) ? avatar : undefined }; };

  // ── Painel principal ─────────────────────────────────────────────
  const buildPanel = (queue = null) => {
    const track = queue?.currentTrack;
    if (!track) return buildFinishedPanel(queue, 'ended');

    const isPaused = Boolean(queue.player?.paused);
    const position = queue.player?.position || 0;
    const volume = queue.volume ?? 100;

    const progress = isLive(track)
      ? '🔴 **AO VIVO**'
      : `${isPaused ? '⏸️' : '▶️'} \`${formatDuration(position)}\` ${progressBar(position, track.durationMS)} \`${formatDuration(track.durationMS)}\``;

    const next = queue.tracks.slice(0, 3).map((t, i) => `\`${i + 1}.\` ${esc(cut(t.title, 44))} · \`${lengthOf(t)}\``);
    const hidden = queue.tracks.length - next.length;
    const upNext = next.length
      ? next.join('\n') + (hidden > 0 ? `\n*…e mais ${plural(hidden, 'música', 'músicas')} — veja em 📜 Fila*` : '')
      : '*Fila vazia — clique em ➕ Adicionar para pedir a próxima.*';
    const upNextTitle = queue.tracks.length
      ? `⏭️ A seguir · ${plural(queue.tracks.length, 'música', 'músicas')} · ${formatLong(sumDuration(queue.tracks))}`
      : '⏭️ A seguir';

    const embed = new EmbedBuilder()
      .setColor(isPaused ? THEME.paused : THEME.playing)
      .setAuthor({ name: `${isPaused ? 'PAUSADO' : 'TOCANDO AGORA'} • ${BOT_DISPLAY_NAME}`, iconURL: cloneIcon() })
      .setTitle(cut(track.title, 256))
      .setDescription(`🎤 ${esc(cut(track.author || 'Artista desconhecido', 100))}\n\n${progress}`)
      .addFields(
        { name: '🎧 Pedida por', value: requesterOf(track), inline: true },
        { name: '🔊 Canal', value: `<#${queue.metadata.voiceChannelId}>`, inline: true },
        { name: '🎚️ Volume', value: `\`${volume}%\``, inline: true },
        { name: upNextTitle, value: upNext },
      )
      .setFooter(queue.lastAction?.text
        ? { text: queue.lastAction.text, iconURL: queue.lastAction.icon }
        : { text: `${BOT_DISPLAY_NAME} • use os botões abaixo` });

    if (isHttp(track.url)) embed.setURL(track.url);
    if (isHttp(track.thumbnail)) embed.setImage(track.thumbnail);

    const rows = [
      row(
        button(ctrlId('toggle_pause'), { label: isPaused ? 'Retomar' : 'Pausar', emoji: isPaused ? '▶️' : '⏸️', style: isPaused ? ButtonStyle.Success : ButtonStyle.Primary }),
        button(ctrlId('skip'), { label: 'Pular', emoji: '⏭️' }),
        button(ctrlId('stop'), { label: 'Parar', emoji: '⏹️', style: ButtonStyle.Danger }),
        button('music:play', { label: 'Adicionar', emoji: '➕', style: ButtonStyle.Success }),
      ),
      row(
        button(ctrlId('vol_down'), { emoji: '🔉', disabled: volume <= 0 }),
        button(ctrlId('vol_up'), { emoji: '🔊', disabled: volume >= 100 }),
        button(ctrlId('queue'), { label: 'Fila', emoji: '📜' }),
        button(ctrlId('favorite'), { label: 'Favoritar', emoji: '⭐' }),
      ),
    ];

    return toPayload(embed, rows);
  };

  // Painel quando a fila acaba ou alguém clica em Parar.
  const buildFinishedPanel = (queue, reason = 'ended', byName = null) => {
    const last = queue?.lastTrack;
    const stopped = reason === 'stopped';
    const embed = new EmbedBuilder()
      .setColor(THEME.idle)
      .setAuthor({ name: `${stopped ? 'PLAYER PARADO' : 'FILA FINALIZADA'} • ${BOT_DISPLAY_NAME}`, iconURL: cloneIcon() })
      .setTitle(stopped ? '⏹️ Reprodução encerrada' : '🌙 A fila acabou')
      .setDescription([
        stopped ? `**${esc(byName || 'Alguém')}** parou o player e o clone saiu do canal.` : 'Todas as músicas foram tocadas e o clone saiu do canal.',
        '',
        'Clique em **➕ Adicionar** ou use `/play` para começar de novo.',
      ].join('\n'))
      .setFooter({ text: `🟢 ${BOT_DISPLAY_NAME} está livre de novo` });
    if (last) embed.addFields({ name: '🎵 Última música', value: trackLink(last, 80) });
    if (isHttp(last?.thumbnail)) embed.setThumbnail(last.thumbnail);
    return toPayload(embed, [row(button('music:play', { label: 'Adicionar música', emoji: '➕', style: ButtonStyle.Success }))]);
  };

  // Painel antigo, depois que um novo /play ou /player criou outro mais abaixo.
  const buildMovedPanel = () => toPayload(
    new EmbedBuilder()
      .setColor(THEME.idle)
      .setDescription(`📌 O painel do **${BOT_DISPLAY_NAME}** foi movido para uma mensagem mais recente.`)
  );

  // Confirmação (só para quem pediu) quando a música vem do botão Adicionar.
  const buildAddedNotice = (queue, added, { startsNow, position, playlistName, voiceChannelId }) => {
    const first = added[0];
    const embed = new EmbedBuilder().setColor(THEME.success).setAuthor({ name: BOT_DISPLAY_NAME, iconURL: cloneIcon() });

    if (added.length > 1) {
      embed.setTitle(`📚 ${cut(playlistName || 'Playlist adicionada', 200)}`)
        .setDescription(`**${added.length}** músicas entraram na fila · ⏱ ${formatLong(sumDuration(added))}${startsNow ? `\n▶️ Começando por ${trackLink(first, 60)}` : ''}`);
    } else if (startsNow) {
      embed.setTitle('▶️ Tocando agora')
        .setDescription(`${trackLink(first, 80)}\nem <#${voiceChannelId}> · \`${lengthOf(first)}\``);
    } else {
      let eta = null;
      const current = queue.currentTrack;
      if (current && !isLive(current) && !queue.tracks.slice(0, position).some(isLive)) {
        eta = Math.max(0, (current.durationMS || 0) - (queue.player?.position || 0)) + sumDuration(queue.tracks.slice(0, position));
      }
      embed.setTitle('➕ Adicionada à fila')
        .setDescription(`${trackLink(first, 80)}\nPosição **#${position + 1}** · \`${lengthOf(first)}\`${eta !== null ? ` · toca em ~${formatLong(eta)}` : ''}`);
    }

    if (isHttp(first.thumbnail)) embed.setThumbnail(first.thumbnail);
    return toPayload(embed);
  };

  // ── Fila com paginação ───────────────────────────────────────────
  const QUEUE_PAGE_SIZE = 10;

  const buildQueueView = (queue, requestedPage = 0) => {
    const track = queue.currentTrack;
    const total = queue.tracks.length;
    const pages = Math.max(1, Math.ceil(total / QUEUE_PAGE_SIZE));
    const page = Math.min(Math.max(0, Number(requestedPage) || 0), pages - 1);
    const start = page * QUEUE_PAGE_SIZE;
    const pad = Math.max(2, String(total).length);
    const isPaused = Boolean(queue.player?.paused);
    const position = queue.player?.position || 0;

    const lines = queue.tracks.slice(start, start + QUEUE_PAGE_SIZE)
      .map((t, i) => `\`${String(start + i + 1).padStart(pad, '0')}\` ${trackLink(t, 48)} · \`${lengthOf(t)}\``);

    const remaining = sumDuration(queue.tracks) + (isLive(track) ? 0 : Math.max(0, (track.durationMS || 0) - position));

    const description = [
      `**${isPaused ? '⏸️ Pausado' : '▶️ Tocando agora'}**`,
      trackLink(track, 70),
      `${isLive(track) ? '🔴 AO VIVO' : `\`${formatDuration(position)} / ${formatDuration(track.durationMS)}\``} · ${requesterOf(track)}`,
      '',
      `**⏭️ A seguir** · ${plural(total, 'música', 'músicas')}`,
      lines.length ? lines.join('\n') : '*A fila está vazia — use ➕ Adicionar ou `/play`.*',
    ].join('\n');

    const embed = new EmbedBuilder()
      .setColor(isPaused ? THEME.paused : THEME.playing)
      .setAuthor({ name: `Fila do ${BOT_DISPLAY_NAME}`, iconURL: cloneIcon() })
      .setDescription(description)
      .setFooter({ text: `Página ${page + 1} de ${pages} • ⏱ ${formatLong(remaining)} restantes` })
      .setTimestamp();

    const nav = (target, tag, emoji, disabled, extra = {}) => button(`fila:${BOT_NAME}:${Math.max(0, target)}:${tag}`, { emoji, disabled, ...extra });
    const rows = [row(
      nav(0, 'first', '⏮️', page === 0),
      nav(page - 1, 'prev', '◀️', page === 0),
      nav(page, 'refresh', '🔄', false, { label: `${page + 1}/${pages}`, style: ButtonStyle.Primary }),
      nav(page + 1, 'next', '▶️', page >= pages - 1),
      nav(pages - 1, 'last', '⏭️', page >= pages - 1),
    )];

    return toPayload(embed, rows);
  };

  // ── Envio do painel / respostas ──────────────────────────────────
  const pushPanel = (queue, view) => {
    const m = queue?.metadata;
    if (!m?.panelMessageId) return;
    process.send?.({
      type: 'panel_update',
      guildId: m.guildId,
      channelId: m.panelChannelId,
      messageId: m.panelMessageId,
      applicationId: m.applicationId,
      interactionToken: m.interactionToken,
      payload: view || buildPanel(queue),
    });
  };

  // Troca o painel "ao vivo" por uma mensagem nova; o antigo vira um aviso curto.
  const adoptPanel = (queue, msg, tokenIsPanel) => {
    const m = queue.metadata;
    if (!msg.panelMessageId) return;
    const sameMessage = m.panelMessageId === msg.panelMessageId;
    if (m.panelMessageId && !sameMessage) pushPanel(queue, buildMovedPanel());
    m.panelMessageId = msg.panelMessageId;
    m.panelChannelId = msg.panelChannelId || m.panelChannelId;
    if (tokenIsPanel) { m.interactionToken = msg.interactionToken; m.applicationId = msg.applicationId; }
    else if (!sameMessage) m.interactionToken = null;
  };

  const editReply = (msg, payload) => process.send?.({ type: 'control_result', interactionToken: msg.interactionToken, applicationId: msg.applicationId, payload });
  // Botões do painel usam deferUpdate: avisos vão como mensagem só para quem clicou, sem mexer no painel.
  const respond = (msg, payload) => process.send?.({ type: msg.deferred === 'update' ? 'interaction_followup' : 'control_result', interactionToken: msg.interactionToken, applicationId: msg.applicationId, payload });

  // ── Reprodução (lógica original) ─────────────────────────────────
  const leaveVoice = async (guildId) => {
    const queue = activeQueues.get(guildId);
    if (queue && queue.updateInterval) clearInterval(queue.updateInterval);
    activeQueues.delete(guildId);
    try { await shoukaku.leaveVoiceChannel(guildId); } catch {}
  };

  const playNext = async (queue) => {
    if (activeQueues.get(queue.metadata.guildId) !== queue) return;

    if (queue.currentTrack) queue.lastTrack = queue.currentTrack;
    queue.currentTrack = queue.tracks.shift();
    if (!queue.currentTrack) {
      pushPanel(queue, buildFinishedPanel(queue, 'ended'));
      await leaveVoice(queue.metadata.guildId);
      process.send?.({ type: 'bot_freed', name: BOT_NAME });
      return;
    }
    try {
      await queue.player.playTrack({ track: { encoded: queue.currentTrack.encoded } });
      pushPanel(queue);
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
          throw new Error('Não encontrei essa música. Tente de novo usando só o título.');
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
            requesterName: msg.requesterName,
            requesterId: msg.requesterId,
          }));

        if (!mapped.length) throw new Error('Não encontrei essa música. Tente de novo usando só o título.');

        let queue = activeQueues.get(msg.guildId);
        if (!queue) {
          const player = await shoukaku.joinVoiceChannel({ guildId: msg.guildId, channelId: msg.voiceChannelId, shardId: 0, deaf: true });

          queue = {
            player,
            tracks: [],
            currentTrack: null,
            volume: 100,
            metadata: {
              guildId: msg.guildId,
              voiceChannelId: msg.voiceChannelId,
              interactionToken: msg.panelReply ? msg.interactionToken : null,
              applicationId: msg.applicationId,
              panelMessageId: msg.panelMessageId || null,
              panelChannelId: msg.panelChannelId || null,
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
              pushPanel(queue);
            }
          }, 10000);

          activeQueues.set(msg.guildId, queue);
        } else if (msg.panelMessageId && (msg.panelReply || !queue.metadata.panelMessageId)) {
          adoptPanel(queue, msg, Boolean(msg.panelReply));
        }

        const startsNow = !queue.currentTrack;
        const position = queue.tracks.length;
        queue.tracks.push(...mapped);

        const by = msg.userName || msg.requesterName || 'Alguém';
        setLastAction(queue, mapped.length > 1
          ? `📚 ${by} adicionou ${mapped.length} músicas`
          : `➕ ${by} adicionou "${cut(mapped[0].title, 60)}"${startsNow ? '' : ` · #${position + 1} na fila`}`, msg.userAvatar);

        if (!queue.currentTrack) await playNext(queue);

        process.send?.({
          type: 'play_started', assignedBot: BOT_DISPLAY_NAME, interactionToken: msg.interactionToken, applicationId: msg.applicationId, trackTitle: mapped[0].title, panelReply: msg.panelReply,
          payload: buildAddedNotice(queue, mapped, { startsNow, position, playlistName: result.loadType === 'playlist' ? result.data?.info?.name : null, voiceChannelId: msg.voiceChannelId }),
        });

        pushPanel(queue);
      } catch (err) {
        console.error(`[${BOT_DISPLAY_NAME}] Falha ao tocar:`, err?.message || err);

        const queue = activeQueues.get(msg.guildId);
        if (!queue || !queue.currentTrack) {
          if (queue) await leaveVoice(msg.guildId);
          process.send?.({ type: 'bot_freed', name: BOT_NAME });
        }

        process.send?.({ type: 'play_failed', interactionToken: msg.interactionToken, applicationId: msg.applicationId, payload: notice('error', err?.message || 'Erro desconhecido.', { title: 'Não consegui tocar' }) });
      }
    }

    if (msg.type === 'execute_favorite_toggle') {
      const queue = activeQueues.get(msg.guildId);
      const track = queue?.currentTrack;
      if (!track) return process.send?.({ type: 'favorite_toggle_error', interactionToken: msg.interactionToken, applicationId: msg.applicationId, payload: notice('info', 'Nada tocando no momento.', { emoji: '📭' }) });
      process.send?.({ type: 'favorite_toggle', userId: msg.userId, interactionToken: msg.interactionToken, applicationId: msg.applicationId, track });
    }

    if (msg.type === 'execute_view') {
      const queue = activeQueues.get(msg.guildId);
      if (!queue?.currentTrack) return editReply(msg, notice('info', 'Nada tocando agora. Use `/play` para chamar um clone.', { emoji: '📭' }));
      if (msg.view === 'queue') return editReply(msg, buildQueueView(queue, msg.page));
      if (msg.view === 'player') { adoptPanel(queue, msg, true); return pushPanel(queue); }
    }

    if (msg.type === 'execute_control') {
      const queue = activeQueues.get(msg.guildId);
      if (!queue) return respond(msg, notice('info', 'Nada tocando no momento.', { emoji: '📭' }));

      const fromPanel = msg.deferred === 'update';
      const by = msg.userName || 'Alguém';
      if (fromPanel && msg.panelMessageId) adoptPanel(queue, msg, true);

      try {
        if (msg.action === 'skip') {
          setLastAction(queue, `⏭️ ${by} pulou "${cut(queue.currentTrack?.title, 50)}"`, msg.userAvatar);
          await queue.player.stopTrack();
          // a próxima música atualiza o painel sozinha; isto é só uma garantia
          setTimeout(() => { if (activeQueues.get(msg.guildId) === queue) pushPanel(queue); }, 1500);
          if (!fromPanel) respond(msg, notice('success', 'Música pulada.', { emoji: '⏭️' }));
          return;
        }
        if (msg.action === 'stop') {
          queue.lastTrack = queue.currentTrack || queue.lastTrack;
          queue.tracks = [];
          queue.currentTrack = null;
          await leaveVoice(msg.guildId);
          process.send?.({ type: 'bot_freed', name: BOT_NAME });
          const finished = buildFinishedPanel(queue, 'stopped', by);
          pushPanel(queue, finished);
          if (!fromPanel) respond(msg, finished);
          return;
        }
        if (msg.action === 'toggle_pause') await queue.player.setPaused(!queue.player.paused);
        if (msg.action === 'pause') await queue.player.setPaused(true);
        if (msg.action === 'resume') await queue.player.setPaused(false);
        if (['toggle_pause', 'pause', 'resume'].includes(msg.action)) {
          setLastAction(queue, queue.player.paused ? `⏸️ ${by} pausou a música` : `▶️ ${by} retomou a música`, msg.userAvatar);
        }

        if (['volume', 'vol_up', 'vol_down'].includes(msg.action)) {
          const current = queue.volume ?? 100;
          const level = msg.action === 'volume'
            ? (msg.args?.level ?? 100)
            : Math.max(0, Math.min(100, current + (msg.action === 'vol_up' ? 10 : -10)));
          await queue.player.setGlobalVolume(level);
          queue.volume = level;
          setLastAction(queue, `🎚️ ${by} colocou o volume em ${level}%`, msg.userAvatar);
          if (!fromPanel) respond(msg, notice('success', `Volume em **${level}%**  ${progressBar(level, 100, 10)}`, { emoji: level === 0 ? '🔇' : '🔊' }));
        }

        pushPanel(queue);
        if (!fromPanel && !['volume', 'vol_up', 'vol_down'].includes(msg.action)) {
          respond(msg, notice('success', queue.player.paused ? 'Música pausada.' : 'Música retomada.', { emoji: queue.player.paused ? '⏸️' : '▶️' }));
        }
      } catch (err) {
        console.error(`[${BOT_DISPLAY_NAME}] Erro no controlo:`, err?.message || err);
        respond(msg, notice('error', err?.message || 'Erro desconhecido.'));
      }
    }
  });

  client.login(TOKEN);
}