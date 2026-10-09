require("dotenv").config();
const cluster = require("cluster");
const fs = require("fs");
const path = require("path");

const CONFIG_FILE = path.join(__dirname, "runtime-config.json");

const BOTS = [
  {
    name: "MAIN",
    tokenEnv: "BOT_MAIN_TOKEN",
    displayName: "Kage Bunshin 1",
    isMain: true,
  },
  {
    name: "WORKER_2",
    tokenEnv: "BOT_2_TOKEN",
    displayName: "Kage Bunshin 2",
    isMain: false,
  },
  {
    name: "WORKER_3",
    tokenEnv: "BOT_3_TOKEN",
    displayName: "Kage Bunshin 3",
    isMain: false,
  },
  {
    name: "WORKER_4",
    tokenEnv: "BOT_4_TOKEN",
    displayName: "Kage Bunshin 4",
    isMain: false,
  },
];

const MAIN_BOT_NAME = "MAIN";

function cleanUrl(url) {
  if (!url || typeof url !== "string") return url;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return trimmed;
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return `https://www.youtube.com/watch?v=${v}`;
    }
    if (u.hostname === "youtu.be") {
      return `https://www.youtube.com/watch?v=${u.pathname.slice(1)}`;
    }
    if (u.hostname.includes("spotify.com")) {
      return `${u.origin}${u.pathname}`;
    }
    if (u.hostname.includes("soundcloud.com")) {
      return `${u.origin}${u.pathname}`;
    }
    return `${u.origin}${u.pathname}`;
  } catch {
    return trimmed;
  }
}

if (cluster.isPrimary) {
  const {
    REST,
    Routes,
    SlashCommandBuilder,
    ChannelType,
    PermissionFlagsBits,
  } = require("discord.js");

  let runtimeConfig = { guilds: {} };
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      runtimeConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    } catch {}
    if (!runtimeConfig.guilds) runtimeConfig.guilds = {};
  }

  const saveConfig = () =>
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(runtimeConfig, null, 2));
  const getCommandChannel = (guildId) =>
    runtimeConfig.guilds[guildId]?.commandChannelId || null;
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
  const displayName = (internalName) =>
    BOTS.find((b) => b.name === internalName)?.displayName || internalName;

  const registerBot = (name) => {
    if (!botStates.has(name)) {
      botStates.set(name, {
        name,
        busy: false,
        guildId: null,
        channelId: null,
      });
    }
  };
  const getFreeBot = () => {
    for (const [name, s] of botStates) if (!s.busy) return name;
    return null;
  };
  const markBusy = (name, guildId, channelId) => {
    const s = botStates.get(name);
    if (s) {
      s.busy = true;
      s.guildId = guildId;
      s.channelId = channelId;
    }
  };
  const markFree = (name) => {
    const s = botStates.get(name);
    if (s) {
      s.busy = false;
      s.guildId = null;
      s.channelId = null;
    }
  };
  const findBotInChannel = (guildId, channelId) => {
    for (const [name, s] of botStates) {
      if (s.busy && s.guildId === guildId && s.channelId === channelId)
        return name;
    }
    return null;
  };
  const statusString = () => {
    const all = Array.from(botStates.values());
    if (!all.length) return "Nenhum bot registrado ainda.";
    return all
      .map((b) =>
        b.busy
          ? `🔴 **${displayName(b.name)}** — tocando em <#${b.channelId}>`
          : `🟢 **${displayName(b.name)}** — livre`,
      )
      .join("\n");
  };

  const editInteractionReply = async (
    applicationId,
    interactionToken,
    content,
  ) => {
    const url = `https://discord.com/api/v10/webhooks/${applicationId}/${interactionToken}/messages/@original`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    }).catch((e) => {
      console.error("[Manager] Falha ao editar interação:", e.message);
      return null;
    });
    if (res && !res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`[Manager] Falha (HTTP ${res.status}):`, body);
    }
  };

  const sendToBot = (name, msg) => {
    const w = workersByName.get(name);
    if (w) {
      w.send(msg);
    } else {
      console.error(`[Manager] worker ${name} não existe!`);
    }
  };

  const handleWorkerMessage = (fromBot, msg) => {
    if (msg.type === "ready") {
      registerBot(msg.name);
      console.log(`[Manager] ${displayName(msg.name)} pronto.`);
      return;
    }

    if (msg.type === "set_command_channel") {
      setCommandChannel(msg.guildId, msg.channelId);
      console.log(
        `[Manager] Canal de comandos definido para <#${msg.channelId}>.`,
      );
      return;
    }

    if (msg.type === "unset_command_channel") {
      unsetCommandChannel(msg.guildId);
      console.log(`[Manager] Restrição de canal removida.`);
      return;
    }

    if (msg.type === "status_request") {
      editInteractionReply(
        msg.applicationId,
        msg.interactionToken,
        statusString(),
      );
      return;
    }

    if (msg.type === "bot_freed") {
      markFree(msg.name);
      console.log(`[Manager] ${displayName(msg.name)} liberado.`);
      return;
    }

    if (msg.type === "request_play") {
      const {
        guildId,
        voiceChannelId,
        textChannelId,
        interactionToken,
        applicationId,
      } = msg;

      const allowedChannel = getCommandChannel(guildId);
      if (allowedChannel && textChannelId !== allowedChannel) {
        return editInteractionReply(
          applicationId,
          interactionToken,
          `❌ Comandos de música só podem ser usados em <#${allowedChannel}>.`,
        );
      }

      const existingBot = findBotInChannel(guildId, voiceChannelId);
      if (existingBot) {
        sendToBot(existingBot, { ...msg, type: "execute_play" });
        return;
      }

      const freeBot = getFreeBot();
      if (!freeBot) {
        return editInteractionReply(
          applicationId,
          interactionToken,
          "❌ Todos os Kage Bunshin estão ocupados. Tente novamente em instantes.",
        );
      }

      markBusy(freeBot, guildId, voiceChannelId);
      sendToBot(freeBot, { ...msg, type: "execute_play" });
      console.log(
        `[Manager] ${displayName(freeBot)} designado para "${msg.query}"`,
      );
      return;
    }

    if (msg.type === "request_control") {
      const {
        guildId,
        voiceChannelId,
        interactionToken,
        applicationId,
        action,
        args,
      } = msg;

      const targetBot = findBotInChannel(guildId, voiceChannelId);
      if (!targetBot) {
        return editInteractionReply(
          applicationId,
          interactionToken,
          "❌ Nenhum Kage Bunshin está tocando no seu canal de voz.",
        );
      }

      sendToBot(targetBot, {
        ...msg,
        type: "execute_control",
        action,
        args,
        interactionToken,
        applicationId,
      });
      return;
    }

    if (msg.type === "play_started") {
      editInteractionReply(
        msg.applicationId,
        msg.interactionToken,
        `✅ **${msg.assignedBot}** está tocando: **${msg.trackTitle}** (\`${msg.source}\`)`,
      );
      return;
    }

    if (msg.type === "play_failed") {
      if (msg.releaseBot) {
        markFree(fromBot);
        console.log(
          `[Manager] ${displayName(fromBot)} liberado após falha ao tocar.`,
        );
      }
      editInteractionReply(
        msg.applicationId,
        msg.interactionToken,
        `❌ Falha ao tocar: ${msg.error}`,
      );
      return;
    }

    if (msg.type === "control_result") {
      editInteractionReply(
        msg.applicationId,
        msg.interactionToken,
        msg.content,
      );
      return;
    }
  };

  const registerCommands = async () => {
    const commands = [
      new SlashCommandBuilder()
        .setName("play")
        .setDescription(
          "Toca uma música do YouTube, SoundCloud, Spotify ou Apple Music",
        )
        .addStringOption((o) =>
          o
            .setName("query")
            .setDescription("Nome da música ou link")
            .setRequired(true),
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName("skip")
        .setDescription("Pula a música atual")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("stop")
        .setDescription("Para a música e desconecta")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("pause")
        .setDescription("Pausa a música atual")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("resume")
        .setDescription("Retoma a música pausada")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("queue")
        .setDescription("Mostra a fila de músicas")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("nowplaying")
        .setDescription("Mostra a música atual")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("volume")
        .setDescription("Ajusta o volume (0-100)")
        .addIntegerOption((o) =>
          o
            .setName("nivel")
            .setDescription("Volume de 0 a 100")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(100),
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName("loop")
        .setDescription("Alterna o modo de repetição")
        .addStringOption((o) =>
          o
            .setName("modo")
            .setDescription("Modo de loop")
            .setRequired(true)
            .addChoices(
              { name: "Off", value: "off" },
              { name: "Música", value: "track" },
              { name: "Fila", value: "queue" },
              { name: "Autoplay", value: "autoplay" },
            ),
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName("shuffle")
        .setDescription("Embaralha a fila")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("setup")
        .setDescription("Define o canal de comandos deste servidor")
        .addChannelOption((o) =>
          o
            .setName("canal")
            .setDescription("Canal de texto")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .toJSON(),
      new SlashCommandBuilder()
        .setName("unsetup")
        .setDescription("Remove a restrição de canal")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .toJSON(),
      new SlashCommandBuilder()
        .setName("status")
        .setDescription("Mostra quais bots estão livres ou ocupados")
        .toJSON(),
      new SlashCommandBuilder()
        .setName("help")
        .setDescription("Lista todos os comandos")
        .toJSON(),
    ];

    const rest = new REST({ version: "10" }).setToken(
      process.env.BOT_MAIN_TOKEN,
    );
    try {
      console.log("[Manager] Registrando comandos globais...");
      await rest.put(Routes.applicationCommands(process.env.MAIN_CLIENT_ID), {
        body: commands,
      });
      console.log("[Manager] ✅ Comandos registrados.");
    } catch (err) {
      console.error("[Manager] Erro ao registrar comandos:", err);
    }
  };

  for (const bot of BOTS) {
    const token = process.env[bot.tokenEnv];
    if (!token) {
      console.error(
        `[Manager] Token ausente para ${bot.displayName} (${bot.tokenEnv})`,
      );
      continue;
    }

    const worker = cluster.fork({
      BOT_NAME: bot.name,
      BOT_DISPLAY_NAME: bot.displayName,
      DISCORD_TOKEN: token,
      IS_MAIN: bot.isMain ? "true" : "false",
    });

    worker.customBotName = bot.name;
    worker.customDisplayName = bot.displayName;

    workersByName.set(bot.name, worker);
    worker.on("message", (msg) => handleWorkerMessage(bot.name, msg));
  }

  cluster.on("exit", (worker, code) => {
    const name = worker.customBotName;
    const dn = worker.customDisplayName || name;
    console.log(`[Manager] ${dn} caiu (code${code}). Reiniciando...`);
    if (name) markFree(name);
    const bot = BOTS.find((b) => b.name === name);
    if (bot) {
      const newWorker = cluster.fork({
        BOT_NAME: bot.name,
        BOT_DISPLAY_NAME: bot.displayName,
        DISCORD_TOKEN: process.env[bot.tokenEnv],
        IS_MAIN: bot.isMain ? "true" : "false",
      });
      newWorker.customBotName = bot.name;
      newWorker.customDisplayName = bot.displayName;
      workersByName.set(bot.name, newWorker);
      newWorker.on("message", (msg) => handleWorkerMessage(bot.name, msg));
    }
  });

  (async () => {
    await registerCommands();
  })();
} else {
  const {
    Client,
    GatewayIntentBits,
    Events,
    EmbedBuilder,
    PermissionFlagsBits,
  } = require("discord.js");
  const { Player, QueueRepeatMode } = require("discord-player");
  const { DefaultExtractors } = require("@discord-player/extractor");

  const BOT_NAME = process.env.BOT_NAME;
  const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME || BOT_NAME;
  const TOKEN = process.env.DISCORD_TOKEN;
  const IS_MAIN = process.env.IS_MAIN === "true";

  console.log(`[${BOT_DISPLAY_NAME}] iniciando...`);

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

  const validateVoiceAccess = async (guild, voiceChannel) => {
    if (
      !voiceChannel ||
      typeof voiceChannel.isVoiceBased !== "function" ||
      !voiceChannel.isVoiceBased()
    ) {
      throw new Error("O canal selecionado não é um canal de voz válido.");
    }

    let botMember = guild.members.me;
    if (!botMember) {
      botMember = await guild.members.fetchMe().catch(() => null);
    }
    if (!botMember) {
      throw new Error(
        "Não consegui confirmar o membro do bot neste servidor.",
      );
    }

    const permissions = voiceChannel.permissionsFor(botMember);
    if (!permissions) {
      throw new Error(
        "Não consegui verificar as permissões do bot no canal de voz.",
      );
    }

    const missing = [];
    if (!permissions.has(PermissionFlagsBits.ViewChannel))
      missing.push("Ver canal");
    if (!permissions.has(PermissionFlagsBits.Connect)) missing.push("Conectar");
    if (!permissions.has(PermissionFlagsBits.Speak)) missing.push("Falar");
    if (missing.length) {
      throw new Error(
        `Falta ao bot a(s) permissão(ões): ${missing.join(", ")}.`,
      );
    }

    return botMember;
  };

  const ensureVoiceConnection = async (
    guild,
    queue,
    voiceChannel,
    botMember,
  ) => {
    const currentChannelId = botMember.voice?.channelId || null;

    if (!queue.connection || currentChannelId !== voiceChannel.id) {
      try {
        await queue.connect(voiceChannel);
      } catch (err) {
        throw new Error(
          `Ocorreu um erro interno ao tentar conectar no canal de voz: ${err.message}`,
        );
      }
    }
  };

  client.once(Events.ClientReady, async (c) => {
    console.log(`[${BOT_DISPLAY_NAME}] online como${c.user.tag}`);

    try {
      // Registrando os extratores padrões do discord-player
      await player.extractors.loadMulti(DefaultExtractors);
      console.log(`[${BOT_DISPLAY_NAME}] Extratores padrões carregados com sucesso.`);
    } catch (err) {
      console.error(`[${BOT_DISPLAY_NAME}] erro ao carregar os extratores padrões:`, err.message);
    }

    if (process.send) process.send({ type: "ready", name: BOT_NAME });
  });

  player.events.on("playerStart", async (queue, track) => {
    console.log(`[${BOT_DISPLAY_NAME}] tocando:${track.title}`);
    if (queue.metadata?.channel) {
      queue.metadata.channel.send(
        `▶️ **${BOT_DISPLAY_NAME}** está tocando: **${track.title}** (\`${track.source}\`)`,
      );
    }

    try {
      const voiceChannel = queue.guild?.members?.me?.voice?.channel;
      if (voiceChannel && typeof voiceChannel.setStatus === "function") {
        const statusText = `▶️ ${track.title} -${track.author}`.substring(
          0,
          499,
        );
        await voiceChannel.setStatus(statusText).catch(() => {});
      }
    } catch (err) {
      console.error(
        `[${BOT_DISPLAY_NAME}] erro ao definir status do canal:`,
        err.message,
      );
    }
  });

  player.events.on("audioTrackAdd", (queue, track) => {
    if (queue.metadata?.channel && queue.tracks.size > 0) {
      queue.metadata.channel.send(`➕ Adicionado à fila: **${track.title}**`);
    }
  });

  player.events.on("emptyQueue", async (queue) => {
    if (queue.metadata?.channel) {
      queue.metadata.channel.send(
        `⏹️ **${BOT_DISPLAY_NAME}** terminou a fila.`,
      );
    }

    try {
      const voiceChannel = queue.guild?.members?.me?.voice?.channel;
      if (voiceChannel && typeof voiceChannel.setStatus === "function") {
        await voiceChannel.setStatus(null).catch(() => {});
      }
    } catch (err) {}

    activeQueues.delete(queue.guild.id);
    if (process.send) process.send({ type: "bot_freed", name: BOT_NAME });
  });

  player.events.on("error", async (queue, error) => {
    console.error(`[${BOT_DISPLAY_NAME}] erro geral:`, error.message);
    if (queue?.metadata?.channel)
      queue.metadata.channel.send(`⚠️ Erro geral: ${error.message}`);

    try {
      const voiceChannel = queue?.guild?.members?.me?.voice?.channel;
      if (voiceChannel && typeof voiceChannel.setStatus === "function") {
        await voiceChannel.setStatus(null).catch(() => {});
      }
    } catch (err) {}

    if (queue?.guild?.id) activeQueues.delete(queue.guild.id);
    if (process.send) process.send({ type: "bot_freed", name: BOT_NAME });
  });

  player.events.on("playerError", (queue, error) => {
    console.error(
      `[${BOT_DISPLAY_NAME}] Erro na stream de áudio:`,
      error.message,
    );
    if (queue.metadata?.channel) {
      queue.metadata.channel.send(
        `⚠️ Erro ao reproduzir a faixa (Stream Falhou). A música pode não estar disponível.`,
      );
    }
  });

  player.on("debug", (message) => {
    console.log(`[DEBUG PLAYER] ${message}`);
  });

  const formatDuration = (ms) => {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  };

  const repeatModeToString = (mode) => {
    switch (mode) {
      case QueueRepeatMode.OFF:
        return "Off";
      case QueueRepeatMode.TRACK:
        return "Música";
      case QueueRepeatMode.QUEUE:
        return "Fila";
      case QueueRepeatMode.AUTOPLAY:
        return "Autoplay";
      default:
        return "Desconhecido";
    }
  };

  const helpEmbed = new EmbedBuilder()
    .setTitle("🎵 Kage Bunshin — Comandos")
    .setDescription(
      "Todos os clones em um só lugar. Use os comandos abaixo para controlar a música.",
    )
    .setColor(0x9b59b6)
    .setThumbnail("https://i.imgur.com/AfFp7pu.png")
    .addFields(
      {
        name: "🎶 Reprodução",
        value: [
          "`/play <música>` — toca uma música (YouTube, SoundCloud, Spotify, Apple Music)",
          "`/skip` — pula para a próxima",
          "`/stop` — para tudo e desconecta",
          "`/pause` — pausa a música atual",
          "`/resume` — retoma a música pausada",
        ].join("\n"),
      },
      {
        name: "📋 Fila",
        value: [
          "`/queue` — mostra a fila de músicas",
          "`/nowplaying` — mostra a música tocando agora",
          "`/shuffle` — embaralha a fila",
          "`/loop <modo>` — repete (off / track / queue / autoplay)",
        ].join("\n"),
      },
      {
        name: "⚙️ Ajustes",
        value: [
          "`/volume <0-100>` — ajusta o volume",
          "`/setup <canal>` — define o canal de comandos (Apenas Admins)",
          "`/unsetup` — remove a restrição de canal (Apenas Admins)",
        ].join("\n"),
      },
      {
        name: "ℹ️ Outros",
        value: [
          "`/status` — mostra quais clones estão livres",
          "`/help` — mostra esta mensagem",
        ].join("\n"),
      },
    )
    .setFooter({ text: "Kage Bunshin • 4 clones ao seu dispor" })
    .setTimestamp();

  if (IS_MAIN) {
    const { PermissionFlagsBits } = require("discord.js");

    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return;

      const cmd = interaction.commandName;
      const guildId = interaction.guildId;
      const interactionToken = interaction.token;
      const applicationId = client.application.id;

      if (cmd === "setup" || cmd === "unsetup") {
        if (
          !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)
        ) {
          return interaction.reply({
            content:
              "❌ Apenas administradores e moderadores (com permissão de Gerenciar Servidor) podem usar este comando.",
            flags: 64,
          });
        }

        if (cmd === "setup") {
          const channel = interaction.options.getChannel("canal");
          if (!channel || !channel.isTextBased()) {
            return interaction.reply({
              content: "❌ Informe um canal de texto válido.",
              flags: 64,
            });
          }
          if (process.send)
            process.send({
              type: "set_command_channel",
              guildId,
              channelId: channel.id,
            });
          return interaction.reply({
            content: `✅ Canal de comandos definido para <#${channel.id}>.`,
            flags: 64,
          });
        }

        if (cmd === "unsetup") {
          if (process.send)
            process.send({ type: "unset_command_channel", guildId });
          return interaction.reply({
            content: "✅ Restrição de canal removida.",
            flags: 64,
          });
        }
      }

      if (cmd === "status") {
        await interaction.deferReply();
        if (process.send)
          process.send({
            type: "status_request",
            guildId,
            interactionToken,
            applicationId,
          });
        return;
      }

      if (cmd === "help") {
        return interaction.reply({ embeds: [helpEmbed], flags: 64 });
      }

      if (cmd === "play") {
        const rawQuery = interaction.options.getString("query");
        const query = cleanUrl(rawQuery);
        const voiceChannel = interaction.member?.voice?.channel;

        if (!voiceChannel) {
          return interaction.reply({
            content: "❌ Entre em um canal de voz primeiro.",
            flags: 64,
          });
        }

        await interaction.deferReply();

        if (process.send) {
          process.send({
            type: "request_play",
            query,
            guildId,
            voiceChannelId: voiceChannel.id,
            textChannelId: interaction.channelId,
            requesterId: interaction.user.id,
            interactionToken,
            applicationId,
          });
        }
        return;
      }

      const controlCommands = [
        "skip",
        "stop",
        "pause",
        "resume",
        "queue",
        "nowplaying",
        "volume",
        "loop",
        "shuffle",
      ];
      if (controlCommands.includes(cmd)) {
        const voiceChannel = interaction.member?.voice?.channel;
        if (!voiceChannel) {
          return interaction.reply({
            content: "❌ Entre em um canal de voz primeiro.",
            flags: 64,
          });
        }
        await interaction.deferReply();

        const args = {};
        if (cmd === "volume")
          args.level = interaction.options.getInteger("nivel");
        if (cmd === "loop") args.mode = interaction.options.getString("modo");

        if (process.send) {
          process.send({
            type: "request_control",
            action: cmd,
            args,
            guildId,
            voiceChannelId: voiceChannel.id,
            interactionToken,
            applicationId,
          });
        }
        return;
      }
    });
  }

  process.on("message", async (msg) => {
    if (msg.type === "execute_play") {
      let queue = null;
      let guild = null;

      try {
        guild = client.guilds.cache.get(msg.guildId);
        if (!guild) throw new Error("Servidor não encontrado pelo bot.");

        const voiceChannel = guild.channels.cache.get(msg.voiceChannelId);
        if (!voiceChannel)
          throw new Error("Canal de voz não encontrado ou inacessível.");

        const botMember = await validateVoiceAccess(guild, voiceChannel);
        const textChannel = guild.channels.cache.get(msg.textChannelId) || null;

        queue = activeQueues.get(msg.guildId);
        if (!queue) {
          queue = player.nodes.create(guild, {
            metadata: { channel: textChannel },
            leaveOnEmpty: false,
            leaveOnEnd: false,
            selfDeaf: true,
            selfMute: false,
            volume: 50,
          });
        } else if (textChannel) {
          queue.metadata = { ...(queue.metadata || {}), channel: textChannel };
        }

        await ensureVoiceConnection(guild, queue, voiceChannel, botMember);
        queue.node.setVolume(50);
        activeQueues.set(msg.guildId, queue);

        let result = await player.search(msg.query, {
          requestedBy: { id: msg.requesterId },
          searchEngine: "auto",
        });

        if (!result.hasTracks()) {
          throw new Error("Nenhum resultado encontrado.");
        }

        await ensureVoiceConnection(guild, queue, voiceChannel, botMember);

        queue.addTrack(result.tracks[0]);
        if (!queue.isPlaying()) await queue.node.play();

        if (process.send) {
          process.send({
            type: "play_started",
            assignedBot: BOT_DISPLAY_NAME,
            interactionToken: msg.interactionToken,
            applicationId: msg.applicationId,
            trackTitle: result.tracks[0].title,
            source: result.tracks[0].source,
          });
        }
      } catch (err) {
        console.error(`[${BOT_DISPLAY_NAME}] erro no play:`, err.message);

        const hasLivePlayback = Boolean(
          queue?.currentTrack && queue?.connection,
        );
        const releaseBot = !hasLivePlayback;
        if (releaseBot) {
          activeQueues.delete(msg.guildId);
          try {
            queue?.delete();
          } catch (cleanupError) {
            console.error(
              `[${BOT_DISPLAY_NAME}] erro ao limpar fila:`,
              cleanupError.message,
            );
          }
        }

        if (process.send) {
          process.send({
            type: "play_failed",
            assignedBot: BOT_DISPLAY_NAME,
            releaseBot,
            interactionToken: msg.interactionToken,
            applicationId: msg.applicationId,
            error: err.message,
          });
        }
      }
      return;
    }

    if (msg.type === "execute_control") {
      const { action, args, interactionToken, applicationId } = msg;
      let content = "";

      try {
        const queue = Array.from(activeQueues.values()).find(
          (q) => q.connection,
        );
        if (!queue) throw new Error("Nenhuma fila ativa neste bot.");

        switch (action) {
          case "skip": {
            if (!queue.currentTrack) throw new Error("Nada está tocando.");
            const skipped = queue.currentTrack.title;
            queue.node.skip();
            content = `⏭️ Pulei: **${skipped}**`;
            break;
          }
          case "stop": {
            try {
              const voiceChannel = queue.guild?.members?.me?.voice?.channel;
              if (
                voiceChannel &&
                typeof voiceChannel.setStatus === "function"
              ) {
                voiceChannel.setStatus(null).catch(() => {});
              }
            } catch (err) {}

            activeQueues.delete(queue.guild.id);
            queue.delete();
            content = "⏹️ Parado e desconectado.";
            if (process.send)
              process.send({ type: "bot_freed", name: BOT_NAME });
            break;
          }
          case "pause":
            queue.node.pause();
            content = "⏸️ Pausado.";
            break;
          case "resume":
            queue.node.resume();
            content = "▶️ Retomado.";
            break;
          case "queue": {
            const current = queue.currentTrack;
            const upcoming = queue.tracks.toArray().slice(0, 10);
            const lines = [];
            if (current)
              lines.push(
                `**Tocando:** ${current.title} \`[${formatDuration(current.durationMS)}]\``,
              );
            if (upcoming.length) {
              lines.push("");
              lines.push("**Próximas:**");
              upcoming.forEach((t, i) =>
                lines.push(
                  `\`${i + 1}.\` ${t.title} \`[${formatDuration(t.durationMS)}]\``,
                ),
              );
            } else {
              lines.push("");
              lines.push("_Fila vazia._");
            }
            content = lines.join("\n");
            break;
          }
          case "nowplaying": {
            const current = queue.currentTrack;
            if (!current) throw new Error("Nada está tocando.");
            content = `🎶 **${current.title}** — \`${current.author}\` \`[${formatDuration(current.durationMS)}]\` (\`${current.source}\`)`;
            break;
          }
          case "volume":
            queue.node.setVolume(args.level);
            content = `🔊 Volume ajustado para **${args.level}%**.`;
            break;
          case "loop": {
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
          case "shuffle":
            queue.tracks.shuffle();
            content = "🔀 Fila embaralhada.";
            break;
          default:
            throw new Error(`Ação desconhecida: ${action}`);
        }
      } catch (err) {
        content = `❌ ${err.message}`;
      }

      if (process.send) {
        process.send({
          type: "control_result",
          interactionToken,
          applicationId,
          content,
        });
      }
      return;
    }
  });

  client.login(TOKEN);
}