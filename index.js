require('dotenv').config();
const cluster = require('cluster');
const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, Events, PermissionFlagsBits, MessageFlags, SlashCommandBuilder, REST, Routes,
  ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder,
  TextInputBuilder, TextInputStyle, ContainerBuilder, TextDisplayBuilder, SectionBuilder, ThumbnailBuilder,
  SeparatorBuilder, SeparatorSpacingSize, InteractionContextType, escapeMarkdown,
} = require('discord.js');

const BOTS = [
  { nome: 'MAIN', token: 'BOT_MAIN_TOKEN', rotulo: 'Kage Bunshin 1' },
  { nome: 'WORKER_2', token: 'BOT_2_TOKEN', rotulo: 'Kage Bunshin 2' },
  { nome: 'WORKER_3', token: 'BOT_3_TOKEN', rotulo: 'Kage Bunshin 3' },
  { nome: 'WORKER_4', token: 'BOT_4_TOKEN', rotulo: 'Kage Bunshin 4' },
];

const ARQ_CONFIG = path.join(__dirname, 'runtime-config.json');
const ARQ_FAVORITAS = path.join(__dirname, 'favorites.json');

const LAVALINK = {
  name: 'Refugio',
  url: process.env.LAVALINK_HOST || 'lavalinkrefugio.discloud.dev:443',
  auth: process.env.LAVALINK_PASSWORD || '',
  secure: process.env.LAVALINK_SECURE !== 'false',
};

const POR_PAGINA = 10;
const MAX_FILA = 1000;
const MAX_FAVORITAS = 250;
const VOLUME_PADRAO = 100;
const VOLUME_MAX = 150;
const OCIOSO_MS = 2 * 60_000;
const VAZIO_MS = 60_000;
const PAINEL_MS = 15_000;
const PEDIDO_MS = 45_000;

const PERM_PRINCIPAL = 3230720;
const PERM_CLONE = 3146752;

const URL_FOTO_DEV = 'https://avatars.githubusercontent.com/Antonizinhobr';
const REDES = [
  { nome: 'Instagram', emoji: '📸', url: 'https://www.instagram.com/_ofcanthonny_santos__/' },
  { nome: 'TikTok', emoji: '🎵', url: 'https://www.tiktok.com/@anthonny_secbr' },
  { nome: 'LinkedIn', emoji: '💼', url: 'https://www.linkedin.com/in/anthonny-michael/' },
  { nome: 'GitHub', emoji: '🐙', url: 'https://github.com/Antonizinhobr' },
  { nome: 'Discord', emoji: '💬', url: 'https://discord.com/users/1400218900284571689' },
];

const COR = { ok: 0x2ecc71, erro: 0xe74c3c, alerta: 0xf1c40f, info: 0x5865f2, pausa: 0xf1c40f, ocioso: 0x4f545c, fim: 0x2b2d31 };
const FONTES = {
  youtube: { nome: 'YouTube', cor: 0xff0033 },
  soundcloud: { nome: 'SoundCloud', cor: 0xff5500 },
  spotify: { nome: 'Spotify', cor: 0x1db954 },
  deezer: { nome: 'Deezer', cor: 0xa238ff },
  applemusic: { nome: 'Apple Music', cor: 0xfa243c },
  twitch: { nome: 'Twitch', cor: 0x9146ff },
  bandcamp: { nome: 'Bandcamp', cor: 0x1da0c3 },
  vimeo: { nome: 'Vimeo', cor: 0x1ab7ea },
  http: { nome: 'Link direto', cor: 0x5865f2 },
};
const REPETIR = {
  off: { proximo: 'fila', nome: 'Não' },
  fila: { proximo: 'musica', nome: 'Fila' },
  musica: { proximo: 'off', nome: 'Música' },
};
const MOTIVOS = {
  parado: '⏹️ O player foi parado',
  ocioso: '💤 Saí da call porque a fila acabou',
  vazio: '👋 Saí da call porque todo mundo saiu',
  desconectado: '🔌 Fui desconectado da call',
  lavalink: '⚠️ O servidor de música caiu',
  caiu: '⚠️ O clone reiniciou',
  removido: '🚪 O clone foi removido do servidor',
  erro: '⚠️ O player parou por um erro',
};
const TRADUCOES = [
  [/sign in to confirm|not a bot/i, 'o YouTube bloqueou o servidor de música (verificação anti-bot)'],
  [/age.?restrict|confirm your age|inappropriate/i, 'o vídeo tem restrição de idade'],
  [/private video/i, 'o vídeo é privado'],
  [/not available in your country|blocked it in your country|copyright/i, 'o vídeo está bloqueado no país do servidor'],
  [/unavailable|does not exist|not found/i, 'o vídeo não está disponível'],
  [/unknown file format|unsupported|no audio/i, 'esse link não é de um áudio ou de uma plataforma suportada'],
  [/premiere|upcoming|live event/i, 'a transmissão ainda não começou'],
];

process.on('unhandledRejection', (erro) => console.error('[Segurança] Promessa rejeitada não tratada:', erro?.message || erro));
process.on('uncaughtException', (erro) => console.error('[Segurança] Exceção não capturada:', erro?.message || erro));

const limitar = (n, min, max) => Math.min(Math.max(n, min), max);
const cortar = (s, n) => {
  const t = String(s ?? '');
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const chave = (guildId, voiceChannelId) => `${guildId}:${voiceChannelId}`;
const ts = (ms, estilo = 'R') => `<t:${Math.floor(ms / 1000)}:${estilo}>`;
const hostDe = (url) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, '');
  } catch {
    return '';
  }
};

function fmtTempo(ms) {
  const total = Math.floor(Math.max(0, ms || 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
const tempoFaixa = (f) => (f.aoVivo ? 'AO VIVO' : fmtTempo(f.duracao));

function lerJSON(arquivo, padrao) {
  try {
    return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {
    return padrao;
  }
}
function salvarJSON(arquivo, dados) {
  try {
    const temporario = `${arquivo}.tmp`;
    fs.writeFileSync(temporario, JSON.stringify(dados, null, 2));
    fs.renameSync(temporario, arquivo);
  } catch (erro) {
    console.error(`[Arquivo] Não consegui salvar ${path.basename(arquivo)}:`, erro.message);
  }
}

function fonteDaUrl(url) {
  const host = hostDe(url);
  if (/youtube\.com$|youtu\.be$/.test(host)) return 'youtube';
  if (/soundcloud\.com$/.test(host)) return 'soundcloud';
  if (/spotify\.(com|link)$/.test(host)) return 'spotify';
  if (/deezer\.(com|page\.link)$/.test(host)) return 'deezer';
  if (host === 'music.apple.com') return 'applemusic';
  if (/twitch\.tv$/.test(host)) return 'twitch';
  if (/bandcamp\.com$/.test(host)) return 'bandcamp';
  if (/vimeo\.com$/.test(host)) return 'vimeo';
  return 'http';
}

function normalizarBusca(bruto) {
  const texto = String(bruto ?? '').trim();
  if (!texto) return null;
  const achado = texto.match(/https?:\/\/[^\s<>]+/i);
  if (!achado) {
    const termo = texto.replace(/^<+|>+$/g, '').trim();
    return termo ? { tipo: 'texto', valor: termo.slice(0, 200) } : null;
  }
  let url;
  try {
    url = new URL(achado[0].replace(/[)\].,!?'"]+$/, ''));
  } catch {
    return { tipo: 'texto', valor: texto.slice(0, 200) };
  }
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/')[1];
    return id ? { tipo: 'url', valor: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com') {
    const lista = url.searchParams.get('list');
    if (url.pathname === '/playlist' && lista) return { tipo: 'url', valor: `https://www.youtube.com/playlist?list=${lista}` };
    const id = url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|live|embed|v)\/([\w-]{6,})/)?.[1];
    if (id) return { tipo: 'url', valor: `https://www.youtube.com/watch?v=${id}` };
    if (lista) return { tipo: 'url', valor: `https://www.youtube.com/playlist?list=${lista}` };
    return { tipo: 'url', valor: url.href };
  }
  for (const p of ['si', 'utm_source', 'utm_medium', 'utm_campaign', 'context', 'nd', 'dlsi', 'go']) url.searchParams.delete(p);
  return { tipo: 'url', valor: url.href };
}

const V2 = MessageFlags.IsComponentsV2;
const EFEMERO = MessageFlags.Ephemeral;
const SEM_MENCOES = { parse: [] };

const txt = (conteudo) => new TextDisplayBuilder().setContent(conteudo);
const sep = (linha = true) => new SeparatorBuilder().setDivider(linha).setSpacing(SeparatorSpacingSize.Small);
const secao = (linhas, imagem) => new SectionBuilder()
  .addTextDisplayComponents(txt(linhas.filter(Boolean).join('\n')))
  .setThumbnailAccessory(new ThumbnailBuilder().setURL(imagem));
const linha = (...itens) => new ActionRowBuilder().addComponents(itens.flat().filter(Boolean));
function botao(id, rotulo, emoji, estilo = ButtonStyle.Secondary, desligado = false) {
  const b = new ButtonBuilder().setCustomId(id).setStyle(estilo).setDisabled(Boolean(desligado));
  if (rotulo) b.setLabel(rotulo);
  if (emoji) b.setEmoji(emoji);
  return b;
}
const botaoLink = (rotulo, url, emoji) => {
  const b = new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(rotulo).setURL(url);
  if (emoji) b.setEmoji(emoji);
  return b;
};

function caixa(cor, partes) {
  const c = new ContainerBuilder().setAccentColor(cor);
  for (const p of partes) {
    if (!p) continue;
    if (p instanceof TextDisplayBuilder) c.addTextDisplayComponents(p);
    else if (p instanceof SeparatorBuilder) c.addSeparatorComponents(p);
    else if (p instanceof SectionBuilder) c.addSectionComponents(p);
    else if (p instanceof ActionRowBuilder) c.addActionRowComponents(p);
  }
  return c;
}
const resposta = (container, { efemero = false } = {}) => ({ components: [container], flags: efemero ? V2 | EFEMERO : V2, allowedMentions: SEM_MENCOES });
const edicao = (container) => ({ components: [container], flags: V2, allowedMentions: SEM_MENCOES });
const ICONES = { ok: '✅', erro: '❌', alerta: '⚠️', info: 'ℹ️' };
const caixaAviso = (tipo, titulo, texto) => caixa(COR[tipo], [txt(`### ${ICONES[tipo]} ${titulo}${texto ? `\n${texto}` : ''}`)]);
const aviso = (tipo, titulo, texto) => resposta(caixaAviso(tipo, titulo, texto), { efemero: true });

function linkFaixa(f, tamanho = 80) {
  const titulo = escapeMarkdown(cortar(f.titulo, tamanho)).replace(/[[\]]/g, '');
  return f.url && /^https?:\/\//.test(f.url) ? `[${titulo}](${f.url.replace(/\)/g, '%29')})` : `**${titulo}**`;
}
function barraProgresso(pos, total, tamanho = 16) {
  const i = total > 0 ? Math.min(tamanho - 1, Math.floor((pos / total) * tamanho)) : 0;
  return `${'▬'.repeat(i)}🔘${'▬'.repeat(tamanho - 1 - i)}`;
}
function posicaoAtual(estado) {
  const corrida = estado.pausado ? 0 : Date.now() - estado.momento;
  const pos = estado.posicao + corrida;
  return estado.atual?.duracao ? Math.min(pos, estado.atual.duracao) : pos;
}

function iniciarGerente({ criarClone } = {}) {
  const ausentes = BOTS.map((b) => b.token).concat(['MAIN_CLIENT_ID', 'LAVALINK_PASSWORD']).filter((v) => !process.env[v]);
  if (ausentes.length) console.warn('⚠️ [Segurança] Variáveis de ambiente ausentes:', ausentes.join(', '));

  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const config = lerJSON(ARQ_CONFIG, { guilds: {} });
  config.guilds ||= {};
  const favoritas = lerJSON(ARQ_FAVORITAS, { users: {} });
  favoritas.users ||= {};
  const clones = new Map();
  const sessoes = new Map();
  const paineis = new Map();
  const pendentes = new Map();
  const idsComandos = new Map();
  let seq = 0;

  const fabricar = criarClone || ((bot) => cluster.fork({ BOT_NAME: bot.nome, BOT_DISPLAY_NAME: bot.rotulo, DISCORD_TOKEN: process.env[bot.token] }));
  const avatarBot = () => client.user?.displayAvatarURL({ size: 256 }) ?? URL_FOTO_DEV;
  const iconeServidor = (guild) => guild.iconURL?.({ size: 256 }) ?? avatarBot();
  const admin = (i) => i.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
  const vozDoMembro = (i) => i.member?.voice?.channel ?? null;
  const conviteClone = (id) => `https://discord.com/oauth2/authorize?client_id=${id}&permissions=${PERM_CLONE}&scope=bot`;
  const convitePrincipal = () => `https://discord.com/oauth2/authorize?client_id=${client.application?.id ?? client.user.id}&permissions=${PERM_PRINCIPAL}&scope=bot%20applications.commands`;

  function cmd(nome, sub) {
    const completo = sub ? `${nome} ${sub}` : nome;
    const id = idsComandos.get(nome);
    return id ? `</${completo}:${id}>` : `\`/${completo}\``;
  }

  function subirClone(bot) {
    const processo = fabricar(bot);
    const c = clones.get(bot.nome) || { ...bot, guilds: new Set(), ocupado: new Map() };
    Object.assign(c, { processo, pronto: false });
    clones.set(bot.nome, c);
    processo.on('message', (m) => {
      try {
        aoMensagemClone(c, m);
      } catch (erro) {
        console.error(`[Player] Erro ao tratar mensagem de ${c.rotulo}:`, erro);
      }
    });
    processo.on('exit', () => aoCairClone(c, bot));
  }

  function aoCairClone(c, bot) {
    if (!c.pronto && c.caiu) return;
    c.pronto = false;
    c.caiu = true;
    console.warn(`[Player] ${c.rotulo} caiu. Reiniciando em 5s...`);
    for (const s of [...sessoes.values()]) if (s.clone === c.nome) finalizarSessao(s, 'caiu');
    for (const [req, p] of pendentes) if (p.clone === c.nome) p.resolver({ ok: false, erro: 'O clone reiniciou no meio do pedido. Tente de novo.' }, req);
    c.ocupado.clear();
    setTimeout(() => {
      c.caiu = false;
      subirClone(bot);
    }, 5000);
  }

  function pedir(c, mensagem, ms = PEDIDO_MS) {
    const req = ++seq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolver({ ok: false, erro: 'O clone demorou demais para responder. Tente de novo.' }), ms);
      function resolver(r) {
        clearTimeout(timer);
        pendentes.delete(req);
        resolve(r);
      }
      pendentes.set(req, { clone: c?.nome, resolver });
      if (!c?.pronto) return resolver({ ok: false, erro: 'Esse clone está offline agora. Tente em alguns segundos.' });
      try {
        c.processo.send({ ...mensagem, req });
      } catch {
        resolver({ ok: false, erro: 'Esse clone está offline agora. Tente em alguns segundos.' });
      }
    });
  }

  function aoMensagemClone(c, m) {
    if (!m?.t) return;
    if (m.t === 'pronto') {
      Object.assign(c, { pronto: true, id: m.id, avatar: m.avatar, guilds: new Set(m.guilds) });
      return console.log(`[Player] ${c.rotulo} pronto (${m.guilds.length} servidores).`);
    }
    if (m.t === 'guilds') {
      c.guilds = new Set(m.guilds);
      return;
    }
    if (m.t === 'resposta') return pendentes.get(m.req)?.resolver(m);
    if (m.t === 'estado') {
      let s = sessaoDoClone(c, m.guildId);
      if (!s) {
        s = { guildId: m.guildId, voiceChannelId: m.estado.voiceChannelId, clone: c.nome, painel: null };
        sessoes.set(chave(s.guildId, s.voiceChannelId), s);
        c.ocupado.set(s.guildId, s.voiceChannelId);
      }
      if (s.voiceChannelId !== m.estado.voiceChannelId) recolocar(s, m.estado.voiceChannelId);
      s.sid = m.sid;
      s.estado = m.estado;
      s.versao = (s.versao || 0) + 1;
      return atualizarPainel(s);
    }
    if (m.t === 'posicao') {
      const s = sessaoDoClone(c, m.guildId);
      if (s?.estado) Object.assign(s.estado, { posicao: m.posicao, momento: m.momento });
      return;
    }
    if (m.t === 'fim') {
      const s = sessaoDoClone(c, m.guildId);
      if (!s || (s.sid != null && m.sid != null && s.sid !== m.sid)) return;
      finalizarSessao(s, m.motivo, m.tocadas);
    }
  }

  const sessaoDoClone = (c, guildId) => [...sessoes.values()].find((s) => s.clone === c.nome && s.guildId === guildId);

  function recolocar(s, novoCanal) {
    if (sessoes.get(chave(s.guildId, s.voiceChannelId)) === s) sessoes.delete(chave(s.guildId, s.voiceChannelId));
    s.voiceChannelId = novoCanal;
    sessoes.set(chave(s.guildId, novoCanal), s);
    clones.get(s.clone)?.ocupado.set(s.guildId, novoCanal);
  }

  function removerSessao(s) {
    s.encerrada = true;
    if (sessoes.get(chave(s.guildId, s.voiceChannelId)) === s) sessoes.delete(chave(s.guildId, s.voiceChannelId));
    const c = clones.get(s.clone);
    if (c?.ocupado.get(s.guildId) === s.voiceChannelId) c.ocupado.delete(s.guildId);
    if (s.painel) paineis.delete(s.painel.msgId);
  }

  async function finalizarSessao(s, motivo, tocadas) {
    removerSessao(s);
    if (!s.painel) return;
    await s.edicao?.catch(() => {});
    const texto = motivo === 'parado' && s.paradoPor ? `⏹️ Parado por <@${s.paradoPor}>` : MOTIVOS[motivo] || MOTIVOS.erro;
    const qtd = tocadas ?? s.estado?.tocadas ?? 0;
    const canal = client.channels.cache.get(s.painel.canalId);
    await canal?.messages.edit(s.painel.msgId, edicao(caixa(COR.fim, [
      txt(`### ${texto}`),
      txt(`-# ${qtd} ${qtd === 1 ? 'música tocada' : 'músicas tocadas'} nesta sessão · use ${cmd('play')} para começar de novo`),
    ]))).catch(() => {});
  }

  function escolherClone(guildId) {
    for (const c of clones.values()) if (c.pronto && c.guilds.has(guildId) && !c.ocupado.has(guildId)) return c;
    return null;
  }

  function cloneParaCall(guildId, voiceChannelId) {
    const s = sessoes.get(chave(guildId, voiceChannelId));
    const c = s && clones.get(s.clone);
    return c?.pronto ? c : escolherClone(guildId);
  }

  async function pedirTocar({ guild, vc, user, busca, faixas, proxima }) {
    const k = chave(guild.id, vc.id);
    let s = sessoes.get(k);
    let c = s && clones.get(s.clone);
    if (!s || !c?.pronto) {
      c = escolherClone(guild.id);
      if (!c) return { ok: false, semClone: true };
      s = { guildId: guild.id, voiceChannelId: vc.id, clone: c.nome, painel: null, estado: null, sid: null };
      sessoes.set(k, s);
      c.ocupado.set(guild.id, vc.id);
    }
    const r = await pedir(c, {
      t: 'tocar', guildId: guild.id, voiceChannelId: vc.id, busca: busca ?? null, faixas: faixas ?? null,
      proxima: Boolean(proxima), solicitante: { id: user.id, nome: user.username },
    });
    const atual = sessaoDoClone(c, guild.id);
    if (!r.ok && atual && !atual.estado) removerSessao(atual);
    return { ...r, sessao: r.ok ? atual : null };
  }

  function caixaSemClone(guild) {
    const presentes = [...clones.values()].filter((c) => c.pronto && c.guilds.has(guild.id));
    const faltam = [...clones.values()].filter((c) => c.pronto && c.id && !c.guilds.has(guild.id)).slice(0, 5);
    if (!presentes.length) return caixaAviso('alerta', 'O player está iniciando', 'Os clones estão conectando. Tente de novo em alguns segundos.');
    return caixa(COR.alerta, [
      txt(`### 🥷 Todos os clones estão ocupados\n${presentes.length === 1 ? 'O clone deste servidor já está' : `Os ${presentes.length} clones deste servidor já estão`} tocando em outras calls. Espere uma terminar${faltam.length ? ' ou convide mais clones para tocar em mais calls ao mesmo tempo' : ''}.`),
      faltam.length ? linha(faltam.map((c) => botaoLink(`Convidar ${c.rotulo}`, conviteClone(c.id), '➕'))) : null,
    ]);
  }
  const semClone = (guild) => resposta(caixaSemClone(guild), { efemero: true });

  function canalPainel(guild, padrao) {
    const id = config.guilds[guild.id]?.commandChannelId;
    return (id && guild.channels.cache.get(id)) || padrao;
  }

  async function publicarPainel(s, { interacao, canal }) {
    const antigo = s.painel;
    const versao = s.versao;
    const payload = montarPainel(s);
    s.publicando = true;
    let msg;
    try {
      msg = interacao ? await interacao.editReply(payload) : await canal.send(payload);
    } finally {
      s.publicando = false;
    }
    s.painel = { canalId: msg.channelId, msgId: msg.id };
    paineis.set(msg.id, chave(s.guildId, s.voiceChannelId));
    s.ultimaEdicao = Date.now();
    if (antigo && antigo.msgId !== msg.id) {
      paineis.delete(antigo.msgId);
      client.channels.cache.get(antigo.canalId)?.messages.delete(antigo.msgId).catch(() => {});
    }
    if (s.versao !== versao) atualizarPainel(s);
  }

  async function garantirPainel(s, guild, canalPadrao) {
    if (s && !s.painel && !s.publicando && !s.encerrada) await publicarPainel(s, { canal: canalPainel(guild, canalPadrao) }).catch((e) => console.error('[Player] Não consegui publicar o painel:', e.message));
  }

  function atualizarPainel(s) {
    if (!s.painel || s.encerrada) return;
    if (s.editando) {
      s.editarDepois = true;
      return;
    }
    s.editando = true;
    s.edicao = (async () => {
      try {
        await editarPainel(s);
      } finally {
        s.editando = false;
        if (s.editarDepois && !s.encerrada) {
          s.editarDepois = false;
          atualizarPainel(s);
        }
      }
    })();
  }

  async function editarPainel(s) {
    const canal = client.channels.cache.get(s.painel.canalId);
    if (!canal) {
      s.painel = null;
      return;
    }
    const payload = montarPainel(s);
    try {
      await canal.messages.edit(s.painel.msgId, payload);
      s.ultimaEdicao = Date.now();
    } catch (erro) {
      paineis.delete(s.painel.msgId);
      if (erro.code === 10008) {
        s.painel = null;
        return;
      }
      if (s.encerrada) return;
      console.error('[Player] Não consegui editar o painel, mandando um novo:', erro.message);
      const nova = await canal.send(payload).catch(() => null);
      s.painel = nova ? { canalId: canal.id, msgId: nova.id } : null;
      if (nova) {
        paineis.set(nova.id, chave(s.guildId, s.voiceChannelId));
        s.ultimaEdicao = Date.now();
      }
    }
  }

  function atualizarPaineis() {
    const agora = Date.now();
    for (const s of sessoes.values()) {
      if (s.painel && s.estado?.atual && !s.estado.pausado && agora - (s.ultimaEdicao || 0) >= PAINEL_MS - 1000) atualizarPainel(s);
    }
  }

  function montarPainel(s) {
    const c = clones.get(s.clone);
    const e = s.estado;
    const avatar = c?.avatar || avatarBot();
    if (!e) return edicao(caixa(COR.info, [txt('### ⏳ Preparando o player...')]));
    const volEmoji = e.volume === 0 ? '🔇' : e.volume < 50 ? '🔈' : e.volume < 100 ? '🔉' : '🔊';
    const info = `-# <#${s.voiceChannelId}> · ${volEmoji} ${e.volume}% · 🔁 Repetir: ${REPETIR[e.repetir].nome} · 🥷 ${c?.rotulo ?? s.clone}`;
    const avisoRecente = e.aviso ? `-# ⚠️ Pulei **${escapeMarkdown(cortar(e.aviso.titulo, 50))}**: ${escapeMarkdown(cortar(e.aviso.motivo, 140))}` : null;

    if (!e.atual) {
      return edicao(caixa(COR.ocioso, [
        secao([
          '### ⏹️ A fila acabou',
          `Adicione mais músicas com ➕ ou ${cmd('play')}.`,
          e.ociosoAte ? `-# Saio da call ${ts(e.ociosoAte)} se ninguém adicionar nada.` : null,
        ], avatar),
        txt([info, avisoRecente].filter(Boolean).join('\n')),
        linha(botao('p:add', 'Adicionar', '➕', ButtonStyle.Success), botao('p:parar', 'Sair da call', '⏹️', ButtonStyle.Danger)),
      ]));
    }

    const f = e.atual;
    const fonte = FONTES[f.fonte] || { nome: 'Música', cor: COR.info };
    const pos = posicaoAtual(e);
    const progresso = f.aoVivo ? '🔴 **AO VIVO**' : `\`${fmtTempo(pos)}\` ${barraProgresso(pos, f.duracao)} \`${fmtTempo(f.duracao)}\``;
    const proximas = e.fila.slice(0, 3).map((x, k) => `\`${k + 1}.\` ${linkFaixa(x, 55)} \`${tempoFaixa(x)}\``);
    const resto = e.fila.length - proximas.length;
    const duracaoFila = e.fila.reduce((soma, x) => soma + (x.duracao || 0), 0);

    return edicao(caixa(e.pausado ? COR.pausa : fonte.cor, [
      secao([
        `-# ${e.pausado ? '⏸️ PAUSADO' : '▶️ TOCANDO AGORA'} · ${fonte.nome.toUpperCase()}`,
        `### ${linkFaixa(f, 90)}`,
        `${escapeMarkdown(cortar(f.autor, 60))}${f.pedidoPor ? ` · pedida por <@${f.pedidoPor.id}>` : ''}`,
      ], f.artwork || avatar),
      txt(progresso),
      txt([info, avisoRecente].filter(Boolean).join('\n')),
      sep(),
      txt(e.fila.length
        ? [`**Próximas** · ${e.fila.length} na fila · ${fmtTempo(duracaoFila)}`, ...proximas, resto > 0 ? `-# e mais ${resto} · abra a 📜 Fila para ver tudo` : null].filter(Boolean).join('\n')
        : '**Próximas**\n-# A fila está vazia. Use ➕ para adicionar.'),
      linha(
        e.pausado ? botao('p:pausa', 'Retomar', '▶️', ButtonStyle.Success) : botao('p:pausa', 'Pausar', '⏸️', ButtonStyle.Primary),
        botao('p:pular', 'Pular', '⏭️'),
        botao('p:parar', 'Parar', '⏹️', ButtonStyle.Danger),
        botao('p:repetir', `Repetir: ${REPETIR[e.repetir].nome}`, '🔁', e.repetir === 'off' ? ButtonStyle.Secondary : ButtonStyle.Success),
        botao('p:mix', null, '🔀', ButtonStyle.Secondary, e.fila.length < 2),
      ),
      linha(
        botao('p:add', 'Adicionar', '➕', ButtonStyle.Success),
        botao('p:fila', `Fila (${e.fila.length})`, '📜'),
        botao('p:vol-', null, '🔉', ButtonStyle.Secondary, e.volume <= 0),
        botao('p:vol+', null, '🔊', ButtonStyle.Secondary, e.volume >= VOLUME_MAX),
        botao('p:fav', null, '⭐'),
      ),
    ]));
  }

  function montarAdicionada(d, user) {
    const f = d.primeira;
    const fonte = FONTES[f.fonte] || { cor: COR.info };
    const imagem = f.artwork || avatarBot();
    if (d.playlist || d.total > 1) {
      return caixa(fonte.cor, [secao([
        '-# 📑 PLAYLIST ADICIONADA',
        `### ${escapeMarkdown(cortar(d.playlist || 'Várias músicas', 80))}`,
        `**${d.total}** músicas · pedida por ${user}${d.cortadas ? `\n-# ${d.cortadas} ficaram de fora (limite de ${MAX_FILA} na fila)` : ''}`,
        `-# Começando por ${linkFaixa(f, 60)}`,
      ], imagem)]);
    }
    return caixa(fonte.cor, [secao([
      d.iniciou ? '-# ▶️ TOCANDO AGORA' : `-# ➕ ADICIONADA À FILA · POSIÇÃO #${d.posicao}`,
      `### ${linkFaixa(f, 90)}`,
      `-# ${escapeMarkdown(cortar(f.autor, 50))} · ${tempoFaixa(f)} · pedida por ${user}`,
    ], imagem)]);
  }

  const totalPaginas = (n) => Math.max(1, Math.ceil(n / POR_PAGINA));

  function montarFila(s, pagina) {
    const e = s.estado || { fila: [], repetir: 'off' };
    const c = clones.get(s.clone);
    const paginas = totalPaginas(e.fila.length);
    pagina = limitar(Number(pagina) || 0, 0, paginas - 1);
    const inicio = pagina * POR_PAGINA;
    const itens = e.fila.slice(inicio, inicio + POR_PAGINA);
    const restanteAtual = e.atual && !e.atual.aoVivo ? Math.max(0, e.atual.duracao - posicaoAtual(e)) : 0;
    const total = e.fila.reduce((soma, x) => soma + (x.duracao || 0), 0) + restanteAtual;
    const vc = s.voiceChannelId;
    const id = (acao) => `f:${vc}:${pagina}:${acao}`;

    const linhas = itens.map((x, k) => `\`${String(inicio + k + 1).padStart(2, ' ')}.\` ${linkFaixa(x, 45)} — ${escapeMarkdown(cortar(x.autor, 20))} \`${tempoFaixa(x)}\``);
    const tocando = e.atual
      ? `**Tocando agora:** ${linkFaixa(e.atual, 60)} \`${e.atual.aoVivo ? 'AO VIVO' : `${fmtTempo(posicaoAtual(e))} / ${fmtTempo(e.atual.duracao)}`}\`${e.pausado ? ' ⏸️' : ''}`
      : '**Tocando agora:** nada — a fila acabou';

    return caixa(COR.info, [
      secao([
        '## 📜 Fila',
        `-# <#${vc}> · ${e.fila.length} ${e.fila.length === 1 ? 'música' : 'músicas'} · ${fmtTempo(total)} até acabar · 🔁 Repetir: ${REPETIR[e.repetir].nome}`,
      ], c?.avatar || avatarBot()),
      txt(tocando),
      sep(),
      txt(linhas.length ? linhas.join('\n') : `*A fila está vazia. Use ➕ no player ou ${cmd('play')} para adicionar.*`),
      txt(`-# Página ${pagina + 1}/${paginas}`),
      linha(
        botao(id('ini'), null, '⏮️', ButtonStyle.Secondary, pagina === 0),
        botao(id('ant'), null, '◀️', ButtonStyle.Secondary, pagina === 0),
        botao(id('prox'), null, '▶️', ButtonStyle.Secondary, pagina >= paginas - 1),
        botao(id('fim'), null, '⏭️', ButtonStyle.Secondary, pagina >= paginas - 1),
        botao(id('atual'), 'Atualizar', '🔄'),
      ),
      linha(
        botao(id('mix'), 'Embaralhar', '🔀', ButtonStyle.Secondary, e.fila.length < 2),
        botao(id('limpar'), 'Limpar fila', '🗑️', ButtonStyle.Danger, !e.fila.length),
      ),
      itens.length ? linha(new StringSelectMenuBuilder()
        .setCustomId(`fr:${vc}:${pagina}`)
        .setPlaceholder('🗑️ Tirar uma música desta página da fila...')
        .addOptions(itens.map((x, k) => ({
          label: cortar(`${inicio + k + 1}. ${x.titulo}`, 100),
          description: cortar(`${x.autor} · ${tempoFaixa(x)}`, 100),
          value: String(x.uid),
        })))) : null,
    ]);
  }

  const listaFavoritas = (userId) => favoritas.users[userId] || [];

  function montarFavoritas(user, pagina) {
    const lista = listaFavoritas(user.id);
    const paginas = totalPaginas(lista.length);
    pagina = limitar(Number(pagina) || 0, 0, paginas - 1);
    const inicio = pagina * POR_PAGINA;
    const itens = lista.slice(inicio, inicio + POR_PAGINA);
    const comoFaixa = (f) => ({ titulo: f.title, url: f.url, autor: f.author, duracao: f.durationMS });
    const opcoes = itens.map((f, k) => ({
      label: cortar(`${inicio + k + 1}. ${f.title}`, 100),
      description: cortar(`${f.author || 'Desconhecido'} · ${fmtTempo(f.durationMS)}`, 100),
      value: String(inicio + k),
    }));

    return caixa(0xf1c40f, [
      secao([
        '## ⭐ Suas favoritas',
        lista.length ? `-# ${lista.length} ${lista.length === 1 ? 'música salva' : 'músicas salvas'} · salve mais com ⭐ no player` : '-# Toque em ⭐ no player para salvar a música que está tocando.',
      ], user.displayAvatarURL({ size: 256 })),
      sep(),
      txt(itens.length
        ? itens.map((f, k) => `\`${String(inicio + k + 1).padStart(2, ' ')}.\` ${linkFaixa(comoFaixa(f), 60)} — ${escapeMarkdown(cortar(f.author || 'Desconhecido', 25))} \`${fmtTempo(f.durationMS)}\``).join('\n')
        : '*Nenhuma favorita ainda.*'),
      txt(`-# Página ${pagina + 1}/${paginas}`),
      linha(
        botao(`fv:${pagina}:ant`, null, '◀️', ButtonStyle.Secondary, pagina === 0),
        botao(`fv:${pagina}:prox`, null, '▶️', ButtonStyle.Secondary, pagina >= paginas - 1),
        botao(`fv:${pagina}:todas`, 'Tocar todas', '▶️', ButtonStyle.Success, !lista.length),
      ),
      itens.length ? linha(new StringSelectMenuBuilder().setCustomId(`fvt:${pagina}`).setPlaceholder('▶️ Tocar uma música desta página...').addOptions(opcoes)) : null,
      itens.length ? linha(new StringSelectMenuBuilder().setCustomId(`fvr:${pagina}`).setPlaceholder('🗑️ Tirar uma música das favoritas...').addOptions(opcoes)) : null,
    ]);
  }

  function montarClones(guild) {
    const linhas = [];
    const faltam = [];
    for (const c of clones.values()) {
      if (!c.pronto) linhas.push(`⚫ **${c.rotulo}** — offline`);
      else if (!c.guilds.has(guild.id)) {
        linhas.push(`➕ **${c.rotulo}** — não está neste servidor`);
        if (c.id) faltam.push(c);
      } else if (c.ocupado.has(guild.id)) {
        const vc = c.ocupado.get(guild.id);
        const atual = sessoes.get(chave(guild.id, vc))?.estado?.atual;
        linhas.push(`🎵 **${c.rotulo}** — tocando em <#${vc}>${atual ? ` · ${linkFaixa(atual, 40)}` : ''}`);
      } else linhas.push(`🟢 **${c.rotulo}** — livre`);
    }
    const presentes = [...clones.values()].filter((c) => c.pronto && c.guilds.has(guild.id)).length;
    return caixa(COR.info, [
      secao([
        '## 🥷 Clones',
        `-# ${presentes} de ${clones.size} clones estão neste servidor. Cada um toca em uma call diferente ao mesmo tempo.`,
      ], avatarBot()),
      sep(),
      txt(linhas.join('\n') || 'Nenhum clone configurado.'),
      faltam.length ? txt('-# Convide os que faltam para tocar em mais calls ao mesmo tempo:') : null,
      faltam.length ? linha(faltam.slice(0, 5).map((c) => botaoLink(`Convidar ${c.rotulo}`, conviteClone(c.id), '➕'))) : null,
    ]);
  }

  function montarAjuda(guild, ehAdmin) {
    const presentes = [...clones.values()].filter((c) => c.pronto && c.guilds.has(guild.id)).length;
    return caixa(COR.info, [
      secao(['## 🎵 Como usar o player', 'Tudo o que você precisa para ouvir música com a galera.'], avatarBot()),
      sep(),
      txt([
        '### ▶️ Tocar',
        `${cmd('play')} com o nome ou o link da música. Aceita YouTube, YouTube Music, SoundCloud, links de música do Spotify, Twitch, Bandcamp e links diretos de áudio.`,
        '-# Marque `proxima: True` para ela tocar logo depois da atual.',
      ].join('\n')),
      txt([
        '### 🎛️ Player',
        '⏯️ pausar · ⏭️ pular · ⏹️ parar · 🔁 repetir fila ou música · 🔀 embaralhar',
        '➕ adicionar · 📜 fila completa · 🔉 🔊 volume · ⭐ favoritar',
        '-# Para mexer no player, entre na mesma call dele.',
      ].join('\n')),
      txt([
        '### 📚 Comandos',
        `${cmd('play')} · ${cmd('fila')} · ${cmd('player')} · ${cmd('favoritas')} · ${cmd('clones')} · ${cmd('contato')}`,
        ehAdmin ? `-# Admin: ${cmd('config', 'canal')} restringe o player a um canal · ${cmd('config', 'liberar')} libera de novo` : null,
      ].filter(Boolean).join('\n')),
      txt(`### 🥷 Clones\nEste servidor tem **${presentes}** ${presentes === 1 ? 'clone' : 'clones'}: cada um toca em uma call diferente ao mesmo tempo. Veja quem está livre com ${cmd('clones')}.`),
      linha(botaoLink('Adicionar ao seu servidor', convitePrincipal(), '➕')),
    ]);
  }

  function montarContato() {
    return caixa(COR.info, [
      secao([
        '## 👨‍💻 Anthonny Michael',
        `Desenvolvedor do **${escapeMarkdown(client.user.username)}**.`,
        'Achou um bug, tem uma ideia ou quer um bot para o seu servidor? É só chamar!',
      ], URL_FOTO_DEV),
      sep(),
      txt('-# Apaixonado por tecnologia e automação. Este bot foi feito para a galera ouvir música junto, em várias calls ao mesmo tempo.'),
      linha(REDES.map((r) => botaoLink(r.nome, r.url, r.emoji))),
    ]);
  }

  function sessaoDoUsuario(i) {
    const vc = vozDoMembro(i);
    if (vc) {
      const s = sessoes.get(chave(i.guildId, vc.id));
      if (s) return s;
    }
    const doServidor = [...sessoes.values()].filter((s) => s.guildId === i.guildId);
    return doServidor.length === 1 ? doServidor[0] : null;
  }

  async function checarCanal(i) {
    const canal = config.guilds[i.guildId]?.commandChannelId;
    if (!canal || i.channelId === canal || admin(i) || !i.guild.channels.cache.has(canal)) return true;
    await i.reply(aviso('alerta', 'Canal errado', `Use o player em <#${canal}>.`));
    return false;
  }

  const avisoCall = (s) => aviso('alerta', 'Entre na call', `Você precisa estar em <#${s.voiceChannelId}> para mexer nesse player.`);
  const avisoSemVoz = () => aviso('alerta', 'Entre em um canal de voz', 'Eu toco na call em que você estiver.');

  async function cmdPlay(i) {
    if (!(await checarCanal(i))) return;
    const vc = vozDoMembro(i);
    if (!vc) return i.reply(avisoSemVoz());
    const busca = normalizarBusca(i.options.getString('musica', true));
    if (!busca) return i.reply(aviso('erro', 'Busca vazia', 'Mande o nome ou o link da música.'));
    if (!cloneParaCall(i.guildId, vc.id)) return i.reply(semClone(i.guild));

    await i.deferReply();
    const r = await pedirTocar({ guild: i.guild, vc, user: i.user, busca, proxima: i.options.getBoolean('proxima') });
    if (!r.ok) {
      await i.deleteReply().catch(() => {});
      return i.followUp(r.semClone ? semClone(i.guild) : aviso('erro', 'Não consegui tocar', r.erro));
    }
    if (r.sessao && !r.sessao.painel && !r.sessao.publicando) return publicarPainel(r.sessao, { interacao: i });
    return i.editReply(edicao(montarAdicionada(r.dados, i.user)));
  }

  async function cmdFila(i) {
    const s = sessaoDoUsuario(i);
    if (!s) return i.reply(aviso('info', 'Nada tocando', `Entre na call onde a música está tocando ou use ${cmd('play')}.`));
    return i.reply(resposta(montarFila(s, 0), { efemero: true }));
  }

  async function cmdPlayer(i) {
    if (!(await checarCanal(i))) return;
    const s = sessaoDoUsuario(i);
    if (!s) return i.reply(aviso('info', 'Nada tocando', `Use ${cmd('play')} para começar.`));
    await i.deferReply();
    return publicarPainel(s, { interacao: i });
  }

  async function cmdConfig(i) {
    if (!admin(i)) return i.reply(aviso('erro', 'Acesso negado', 'Só administradores podem usar este comando.'));
    const sub = i.options.getSubcommand();
    config.guilds[i.guildId] ||= {};
    if (sub === 'canal') {
      const canal = i.options.getChannel('canal', true);
      config.guilds[i.guildId].commandChannelId = canal.id;
      salvarJSON(ARQ_CONFIG, config);
      return i.reply(aviso('ok', 'Canal definido', `O ${cmd('play')} e o player agora ficam em <#${canal.id}>.\n-# Admins continuam podendo usar em qualquer canal.`));
    }
    delete config.guilds[i.guildId].commandChannelId;
    salvarJSON(ARQ_CONFIG, config);
    return i.reply(aviso('ok', 'Canal liberado', `O ${cmd('play')} volta a funcionar em todos os canais.`));
  }

  async function registrarComandos() {
    const comandos = [
      new SlashCommandBuilder().setName('play').setDescription('🎵 Toca uma música ou adiciona à fila (nome ou link)')
        .addStringOption((o) => o.setName('musica').setDescription('Nome da música ou link (YouTube, Spotify, SoundCloud...)').setRequired(true).setMaxLength(500))
        .addBooleanOption((o) => o.setName('proxima').setDescription('Tocar logo depois da música atual')),
      new SlashCommandBuilder().setName('fila').setDescription('📜 Mostra a fila completa, com páginas'),
      new SlashCommandBuilder().setName('player').setDescription('🎛️ Traz o player para o fim do chat'),
      new SlashCommandBuilder().setName('favoritas').setDescription('⭐ Suas músicas favoritas'),
      new SlashCommandBuilder().setName('clones').setDescription('🥷 Mostra quais clones estão livres neste servidor'),
      new SlashCommandBuilder().setName('ajuda').setDescription('📖 Como usar o player de música'),
      new SlashCommandBuilder().setName('contato').setDescription('📱 Fale com o desenvolvedor do bot'),
      new SlashCommandBuilder().setName('config').setDescription('⚙️ [ADMIN] Configurações do player')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((s) => s.setName('canal').setDescription('Deixa o /play e o player só em um canal')
          .addChannelOption((o) => o.setName('canal').setDescription('Canal de texto').setRequired(true).addChannelTypes(ChannelType.GuildText)))
        .addSubcommand((s) => s.setName('liberar').setDescription('Libera o /play em todos os canais')),
    ].map((c) => c.setContexts(InteractionContextType.Guild).toJSON());

    const rest = new REST({ version: '10' }).setToken(process.env.BOT_MAIN_TOKEN);
    try {
      const registrados = await rest.put(Routes.applicationCommands(process.env.MAIN_CLIENT_ID || client.application.id), { body: comandos });
      for (const c of registrados) idsComandos.set(c.name, c.id);
      console.log(`[Player] ✅ ${registrados.length} comandos registrados.`);
    } catch (erro) {
      console.error('[Player] Falha ao registrar comandos:', erro?.message || erro);
    }
  }

  async function alternarFavorita(i, s) {
    const t = s.estado?.atual;
    if (!t) return i.reply(aviso('info', 'Nada tocando', 'Não tem música tocando para favoritar.'));
    const lista = (favoritas.users[i.user.id] ||= []);
    const k = t.url || t.titulo.toLowerCase();
    const indice = lista.findIndex((f) => f.key === k);
    if (indice >= 0) {
      lista.splice(indice, 1);
      salvarJSON(ARQ_FAVORITAS, favoritas);
      return i.reply(aviso('info', 'Tirada das favoritas', `☆ ${linkFaixa(t, 80)}`));
    }
    if (lista.length >= MAX_FAVORITAS) return i.reply(aviso('alerta', 'Favoritas cheias', `Você chegou ao limite de ${MAX_FAVORITAS}. Tire algumas em ${cmd('favoritas')}.`));
    lista.push({ key: k, encoded: t.encoded, title: t.titulo, url: t.url, durationMS: t.duracao, author: t.autor, thumbnail: t.artwork, source: t.fonte, addedAt: new Date().toISOString() });
    salvarJSON(ARQ_FAVORITAS, favoritas);
    return i.reply(aviso('ok', 'Salva nas favoritas', `⭐ ${linkFaixa(t, 80)}\n-# Veja todas com ${cmd('favoritas')}.`));
  }

  async function tocarFavoritas(i, itens) {
    const vc = vozDoMembro(i);
    if (!vc) return i.reply(avisoSemVoz());
    const faixas = itens.filter((f) => f && (f.encoded || f.url)).map((f) => ({
      encoded: f.encoded, titulo: f.title, autor: f.author, url: f.url, duracao: f.durationMS || 0,
      artwork: f.thumbnail || null, fonte: f.source || fonteDaUrl(f.url), aoVivo: false,
    }));
    if (!faixas.length) return i.reply(aviso('info', 'Nada para tocar', 'Não achei essas favoritas.'));
    if (!cloneParaCall(i.guildId, vc.id)) return i.reply(semClone(i.guild));
    await i.deferReply({ flags: EFEMERO });
    const r = await pedirTocar({ guild: i.guild, vc, user: i.user, faixas });
    if (!r.ok) return i.editReply(edicao(r.semClone ? caixaSemClone(i.guild) : caixaAviso('erro', 'Não consegui tocar', r.erro)));
    await garantirPainel(r.sessao, i.guild, i.channel);
    return i.editReply(edicao(montarAdicionada({ ...r.dados, playlist: r.dados.total > 1 ? 'Suas favoritas' : null }, i.user)));
  }

  async function aoBotaoPainel(i, acao) {
    const s = sessoes.get(paineis.get(i.message.id));
    if (!s) return i.reply(aviso('info', 'Player encerrado', `Esse player não está mais ativo. Use ${cmd('play')} para começar de novo.`));
    if (acao === 'fila') return i.reply(resposta(montarFila(s, 0), { efemero: true }));
    if (acao === 'fav') return alternarFavorita(i, s);
    if (vozDoMembro(i)?.id !== s.voiceChannelId) return i.reply(avisoCall(s));
    if (acao === 'add') {
      return i.showModal(new ModalBuilder().setCustomId(`m:add:${s.voiceChannelId}`).setTitle('Adicionar à fila').addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder()
          .setCustomId('busca').setLabel('Nome ou link da música').setStyle(TextInputStyle.Short)
          .setRequired(true).setMaxLength(500).setPlaceholder('Ex: Imagine Dragons Believer ou um link do YouTube')),
      ));
    }
    const volume = s.estado?.volume ?? VOLUME_PADRAO;
    const pedido = {
      pausa: { acao: 'pausa' },
      pular: { acao: 'pular' },
      parar: { acao: 'parar' },
      repetir: { acao: 'repetir' },
      mix: { acao: 'embaralhar' },
      'vol-': { acao: 'volume', valor: limitar(volume - 10, 0, VOLUME_MAX) },
      'vol+': { acao: 'volume', valor: limitar(volume + 10, 0, VOLUME_MAX) },
    }[acao];
    if (!pedido) return i.deferUpdate();
    await i.deferUpdate();
    if (acao === 'parar') s.paradoPor = i.user.id;
    const r = await pedir(clones.get(s.clone), { t: 'controle', guildId: s.guildId, ...pedido });
    if (!r.ok) {
      if (acao === 'parar') s.paradoPor = null;
      await i.followUp(aviso('erro', 'Não deu certo', r.erro));
    }
  }

  async function aoBotaoFila(i, [vc, pag, acao]) {
    const s = sessoes.get(chave(i.guildId, vc));
    if (!s) return i.update(edicao(caixaAviso('info', 'Fila encerrada', 'Não tem nada tocando nessa call agora.')));
    const pagina = Number(pag) || 0;
    const ultima = totalPaginas(s.estado?.fila.length ?? 0) - 1;
    const destino = { ini: 0, ant: pagina - 1, prox: pagina + 1, fim: ultima, atual: pagina }[acao];
    if (destino !== undefined) return i.update(edicao(montarFila(s, destino)));
    if (vozDoMembro(i)?.id !== s.voiceChannelId) return i.reply(avisoCall(s));
    await i.deferUpdate();
    const r = await pedir(clones.get(s.clone), { t: 'controle', guildId: s.guildId, acao: acao === 'mix' ? 'embaralhar' : 'limpar' });
    if (!r.ok) await i.followUp(aviso('erro', 'Não deu certo', r.erro));
    return i.editReply(edicao(montarFila(s, acao === 'limpar' ? 0 : pagina)));
  }

  async function aoRemoverDaFila(i, [vc, pag]) {
    const s = sessoes.get(chave(i.guildId, vc));
    if (!s) return i.update(edicao(caixaAviso('info', 'Fila encerrada', 'Não tem nada tocando nessa call agora.')));
    if (vozDoMembro(i)?.id !== s.voiceChannelId) return i.reply(avisoCall(s));
    await i.deferUpdate();
    const r = await pedir(clones.get(s.clone), { t: 'controle', guildId: s.guildId, acao: 'remover', valor: Number(i.values[0]) });
    if (!r.ok) await i.followUp(aviso('erro', 'Não deu certo', r.erro));
    return i.editReply(edicao(montarFila(s, pag)));
  }

  async function aoBotaoFavoritas(i, [pag, acao]) {
    const pagina = Number(pag) || 0;
    if (acao === 'todas') return tocarFavoritas(i, listaFavoritas(i.user.id));
    return i.update(edicao(montarFavoritas(i.user, acao === 'ant' ? pagina - 1 : pagina + 1)));
  }

  async function aoSelectFavoritas(i, tipo, [pag]) {
    const lista = listaFavoritas(i.user.id);
    const indice = Number(i.values[0]);
    const item = lista[indice];
    if (!item) return i.update(edicao(montarFavoritas(i.user, pag)));
    if (tipo === 'fvt') return tocarFavoritas(i, [item]);
    lista.splice(indice, 1);
    salvarJSON(ARQ_FAVORITAS, favoritas);
    return i.update(edicao(montarFavoritas(i.user, pag)));
  }

  async function aoModalAdicionar(i, [, vcPainel]) {
    const vc = vozDoMembro(i);
    if (!vc) return i.reply(avisoSemVoz());
    if (vcPainel && vc.id !== vcPainel) return i.reply(aviso('alerta', 'Entre na call', `Esse player é da call <#${vcPainel}>.`));
    const busca = normalizarBusca(i.fields.getTextInputValue('busca'));
    if (!busca) return i.reply(aviso('erro', 'Busca vazia', 'Mande o nome ou o link da música.'));
    if (!cloneParaCall(i.guildId, vc.id)) return i.reply(semClone(i.guild));
    await i.deferReply({ flags: EFEMERO });
    const r = await pedirTocar({ guild: i.guild, vc, user: i.user, busca });
    if (!r.ok) return i.editReply(edicao(r.semClone ? caixaSemClone(i.guild) : caixaAviso('erro', 'Não consegui tocar', r.erro)));
    await garantirPainel(r.sessao, i.guild, i.channel);
    return i.editReply(edicao(montarAdicionada(r.dados, i.user)));
  }

  const COMANDOS = {
    play: cmdPlay,
    fila: cmdFila,
    player: cmdPlayer,
    favoritas: (i) => i.reply(resposta(montarFavoritas(i.user, 0), { efemero: true })),
    clones: (i) => i.reply(resposta(montarClones(i.guild), { efemero: true })),
    ajuda: (i) => i.reply(resposta(montarAjuda(i.guild, admin(i)), { efemero: true })),
    contato: (i) => i.reply(resposta(montarContato(), { efemero: true })),
    config: cmdConfig,
  };

  client.on(Events.InteractionCreate, async (i) => {
    if (!i.inGuild()) return;
    try {
      if (i.isChatInputCommand()) return await COMANDOS[i.commandName]?.(i);
      if (i.isButton()) {
        const [tipo, ...partes] = i.customId.split(':');
        if (tipo === 'p') return await aoBotaoPainel(i, partes[0]);
        if (tipo === 'f') return await aoBotaoFila(i, partes);
        if (tipo === 'fv') return await aoBotaoFavoritas(i, partes);
        return;
      }
      if (i.isStringSelectMenu()) {
        const [tipo, ...partes] = i.customId.split(':');
        if (tipo === 'fr') return await aoRemoverDaFila(i, partes);
        if (tipo === 'fvt' || tipo === 'fvr') return await aoSelectFavoritas(i, tipo, partes);
        return;
      }
      if (i.isModalSubmit() && i.customId.startsWith('m:add')) return await aoModalAdicionar(i, i.customId.split(':').slice(1));
    } catch (erro) {
      console.error(`[Player] Erro em ${i.commandName ?? i.customId}:`, erro);
      const falha = aviso('erro', 'Algo deu errado', 'Tente de novo em instantes.');
      if (i.deferred || i.replied) await i.followUp(falha).catch(() => {});
      else await i.reply(falha).catch(() => {});
    }
  });

  client.once(Events.ClientReady, async () => {
    console.log(`[Player] Online como ${client.user.tag}`);
    await registrarComandos();
    setInterval(atualizarPaineis, 5000);
  });

  for (const bot of BOTS) if (process.env[bot.token]) subirClone(bot);
  client.login(process.env.BOT_MAIN_TOKEN);

  return { client, clones, sessoes, paineis, favoritas, config };
}

function iniciarClone({ env = process.env, enviar = (m) => process.send?.(m), aoReceber = (fn) => process.on('message', fn) } = {}) {
  const { Shoukaku, Connectors } = require('shoukaku');
  const NOME = env.BOT_NAME;
  const ROTULO = env.BOT_DISPLAY_NAME || NOME;
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
  const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), [LAVALINK], { reconnectTries: 1000, reconnectInterval: 5, restTimeout: 20 });
  const sessoes = new Map();
  const travas = new Map();
  let seq = 0;

  const falha = (mensagem) => Object.assign(new Error(mensagem), { amigavel: true });
  const mensagemErro = (erro) => {
    if (erro?.amigavel) return erro.message;
    console.error(`[${ROTULO}] Erro:`, erro?.message || erro);
    return 'Algo deu errado ao tocar. Tente de novo.';
  };
  const responder = (req, r) => {
    if (req) enviar({ t: 'resposta', req, ...r });
  };
  const semEncoded = ({ encoded, ...resto }) => resto;

  shoukaku.on('ready', (nome) => console.log(`[${ROTULO}] Lavalink conectado (${nome}).`));
  shoukaku.on('error', (_, erro) => console.error(`[${ROTULO}] Erro no Lavalink:`, erro?.message || erro));
  shoukaku.on('close', (nome, codigo, motivo) => console.warn(`[${ROTULO}] Lavalink fechou (${nome}): ${codigo} ${motivo || ''}`));
  shoukaku.on('disconnect', (nome) => {
    console.warn(`[${ROTULO}] Lavalink desconectado (${nome}).`);
    for (const s of [...sessoes.values()]) encerrar(s, 'lavalink');
  });

  function serial(id, tarefa) {
    const anterior = travas.get(id) || Promise.resolve();
    const atual = anterior.then(tarefa, tarefa);
    const guardada = atual.catch(() => {});
    travas.set(id, guardada);
    guardada.then(() => {
      if (travas.get(id) === guardada) travas.delete(id);
    });
    return atual;
  }

  function noLavalink() {
    const no = shoukaku.options?.nodeResolver ? shoukaku.options.nodeResolver(shoukaku.nodes) : shoukaku.getIdealNode?.();
    if (!no) throw falha('O servidor de música (Lavalink) está offline. Tente de novo em instantes.');
    return no;
  }

  async function carregar(no, identificador) {
    try {
      return (await no.rest.resolve(identificador)) ?? { loadType: 'empty' };
    } catch (erro) {
      console.error(`[${ROTULO}] Lavalink não respondeu:`, erro?.message || erro);
      throw falha('O servidor de música não respondeu. Tente de novo em instantes.');
    }
  }

  function motivoLavalink(r) {
    const original = String(r?.data?.message || r?.data?.cause || 'erro desconhecido');
    const traducao = TRADUCOES.find(([padrao]) => padrao.test(original))?.[1];
    return traducao ? `${traducao}.\n-# Lavalink: ${cortar(original, 150)}` : cortar(original, 200);
  }

  function faixa(t) {
    const info = t.info || {};
    return {
      encoded: t.encoded,
      titulo: info.title || 'Sem título',
      autor: info.author || 'Desconhecido',
      url: info.uri || null,
      duracao: info.isStream ? 0 : info.length || 0,
      aoVivo: Boolean(info.isStream),
      artwork: info.artworkUrl || (info.sourceName === 'youtube' && info.identifier ? `https://i.ytimg.com/vi/${info.identifier}/hqdefault.jpg` : null),
      fonte: info.sourceName || 'http',
    };
  }

  function deResultado(r) {
    if (!r) return null;
    if (r.loadType === 'track' && r.data?.encoded) return { faixas: [faixa(r.data)] };
    if (r.loadType === 'playlist' && r.data?.tracks?.length) return { faixas: r.data.tracks.filter((t) => t?.encoded).map(faixa), playlist: r.data.info?.name || 'Playlist' };
    if (r.loadType === 'search' && Array.isArray(r.data) && r.data[0]?.encoded) return { faixas: [faixa(r.data[0])] };
    return null;
  }

  const ehEspelho = (url) => /(^|\.)(spotify\.com|deezer\.com)$|^music\.apple\.com$/.test(hostDe(url));
  function ehListaEspelho(url) {
    const u = new URL(url);
    const host = hostDe(url);
    if (host === 'music.apple.com') return !(u.searchParams.get('i') || /\/song\//.test(u.pathname));
    return !/\/track\//.test(u.pathname);
  }

  const decodificar = (s) => s?.replace(/&(#x?[0-9a-f]+|amp|quot|apos|lt|gt);/gi, (inteiro, codigo) => {
    const nomes = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' };
    if (nomes[codigo.toLowerCase()]) return nomes[codigo.toLowerCase()];
    const numero = codigo[1]?.toLowerCase() === 'x' ? parseInt(codigo.slice(2), 16) : parseInt(codigo.slice(1), 10);
    return Number.isFinite(numero) ? String.fromCodePoint(numero) : inteiro;
  });

  async function baixarPagina(url) {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)', 'Accept-Language': 'en' },
      redirect: 'follow',
      signal: AbortSignal.timeout(8000),
    });
    return { url: res.url || url, html: await res.text() };
  }

  async function expandirLink(url) {
    try {
      const { url: final, html } = await baixarPagina(url);
      if (ehEspelho(final)) return final;
      return html.match(/https:\/\/(?:open\.spotify\.com|www\.deezer\.com)\/[^"'\s<>]+/)?.[0] ?? null;
    } catch {
      return null;
    }
  }

  async function termoDaPagina(url) {
    try {
      const { html } = await baixarPagina(url);
      const meta = (nome) => decodificar(
        html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${nome}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1]
        ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${nome}["']`, 'i'))?.[1],
      );
      const titulo = meta('og:title')?.replace(/\s+on Apple Music$/i, '').replace(/\s*[|-]\s*Deezer$/i, '').trim();
      if (!titulo) return null;
      const artista = hostDe(url).endsWith('spotify.com') ? meta('music:musician_description') || meta('og:description')?.split(' · ')[0] : null;
      return [artista, titulo].filter(Boolean).join(' ').slice(0, 150);
    } catch {
      return null;
    }
  }

  async function buscar(no, busca) {
    if (busca?.tipo === 'texto') {
      const r = await carregar(no, `ytsearch:${busca.valor}`);
      const achou = deResultado(r);
      if (achou) return achou;
      if (r.loadType === 'error') throw falha(`A busca falhou: ${motivoLavalink(r)}`);
      throw falha(`Não encontrei nada para "${cortar(busca.valor, 80)}".`);
    }
    let url = busca?.valor;
    if (!url) throw falha('Mande o nome ou o link da música.');
    if (/(^|\.)(spotify\.link|deezer\.page\.link|link\.deezer\.com)$/.test(hostDe(url))) url = (await expandirLink(url)) || url;
    const r = await carregar(no, url);
    const achou = deResultado(r);
    if (achou) return achou;
    if (ehEspelho(url)) {
      if (ehListaEspelho(url)) throw falha('Playlists e álbuns do Spotify, Deezer e Apple Music precisam do plugin LavaSrc no Lavalink. Por enquanto, mande o link de uma música ou o nome dela.');
      const termo = await termoDaPagina(url);
      if (termo) {
        for (const prefixo of ['ytmsearch:', 'ytsearch:']) {
          const achado = deResultado(await carregar(no, `${prefixo}${termo}`).catch(() => null));
          if (achado) return achado;
        }
      }
      throw falha('Não consegui ler esse link. Tente mandar o nome da música.');
    }
    if (r.loadType === 'error') throw falha(`Não consegui abrir esse link: ${motivoLavalink(r)}`);
    throw falha('Não encontrei nada que eu consiga tocar nesse link.');
  }

  async function prepararFaixas(no, lista) {
    const prontas = [];
    for (const f of lista.slice(0, MAX_FILA)) {
      if (f.encoded) prontas.push(f);
      else if (f.url) {
        const achado = deResultado(await carregar(no, f.url).catch(() => null));
        if (achado) prontas.push(achado.faixas[0]);
      }
    }
    return { faixas: prontas };
  }

  function posicao(s) {
    const r = s.relogio;
    const p = r.base + (r.desde ? Date.now() - r.desde : 0);
    return Math.max(0, s.atual?.duracao ? Math.min(p, s.atual.duracao) : p);
  }

  function ajustarRelogio(s, pausado) {
    if (pausado) s.relogio = { base: posicao(s), desde: null };
    else s.relogio = { base: s.relogio.base, desde: Date.now() };
  }

  function enviarEstado(s) {
    if (s.encerrada) return;
    const aviso = s.aviso && Date.now() - s.aviso.quando < 60_000 ? { titulo: s.aviso.titulo, motivo: s.aviso.motivo } : null;
    enviar({
      t: 'estado',
      guildId: s.guildId,
      sid: s.sid,
      estado: {
        voiceChannelId: s.voiceChannelId,
        atual: s.atual,
        fila: s.fila.map(semEncoded),
        pausado: Boolean(s.player.paused),
        volume: s.volume,
        repetir: s.repetir,
        posicao: posicao(s),
        momento: Date.now(),
        ociosoAte: s.ociosoAte || null,
        aviso,
        tocadas: s.tocadas,
      },
    });
  }

  function limparTimer(s, nome) {
    if (s.timers[nome]) clearTimeout(s.timers[nome]);
    s.timers[nome] = null;
  }

  function entrarOcioso(s) {
    limparTimer(s, 'ocioso');
    s.ociosoAte = Date.now() + OCIOSO_MS;
    s.timers.ocioso = setTimeout(() => encerrar(s, 'ocioso'), OCIOSO_MS);
  }

  function sairDoOcioso(s) {
    limparTimer(s, 'ocioso');
    s.ociosoAte = null;
  }

  function verificarVazio(s) {
    if (s.encerrada) return;
    const canal = client.channels.cache.get(s.voiceChannelId);
    const humanos = canal?.members?.filter((m) => !m.user.bot).size ?? 0;
    if (humanos === 0) {
      if (!s.timers.vazio) s.timers.vazio = setTimeout(() => encerrar(s, 'vazio'), VAZIO_MS);
    } else limparTimer(s, 'vazio');
  }

  async function encerrar(s, motivo) {
    if (s.encerrada) return;
    s.encerrada = true;
    for (const nome of Object.keys(s.timers)) limparTimer(s, nome);
    if (sessoes.get(s.guildId) === s) sessoes.delete(s.guildId);
    try {
      await shoukaku.leaveVoiceChannel(s.guildId);
    } catch {}
    enviar({ t: 'fim', guildId: s.guildId, sid: s.sid, motivo, tocadas: s.tocadas });
  }

  async function proxima(s, { pulou = false, falhou = false } = {}) {
    if (s.encerrada) return;
    const anterior = s.atual;
    let seguinte;
    if (anterior && s.repetir === 'musica' && !pulou && !falhou) seguinte = anterior;
    else {
      if (anterior && s.repetir === 'fila' && !falhou) s.fila.push(anterior);
      seguinte = s.fila.shift();
    }
    if (!seguinte) {
      s.atual = null;
      s.relogio = { base: 0, desde: null };
      entrarOcioso(s);
      return enviarEstado(s);
    }
    sairDoOcioso(s);
    s.atual = seguinte;
    try {
      if (s.player.paused) await s.player.setPaused(false);
      await s.player.playTrack({ track: { encoded: seguinte.encoded } });
      s.relogio = { base: 0, desde: Date.now() };
      s.tocadas += 1;
      enviarEstado(s);
    } catch (erro) {
      s.aviso = { titulo: seguinte.titulo, motivo: erro?.message || 'erro ao tocar', quando: Date.now() };
      s.atual = null;
      return proxima(s, { pulou: true });
    }
  }

  function aoFimFaixa(s, dados) {
    if (s.encerrada || sessoes.get(s.guildId) !== s) return;
    const motivo = dados?.reason;
    if (motivo === 'replaced' || motivo === 'cleanup') return;
    proxima(s, { pulou: motivo !== 'finished', falhou: motivo === 'loadFailed' }).catch((e) => console.error(`[${ROTULO}] Erro ao avançar a fila:`, e?.message || e));
  }

  async function criarSessao(m) {
    const guild = client.guilds.cache.get(m.guildId);
    const canal = guild?.channels.cache.get(m.voiceChannelId);
    if (!canal) throw falha('Não encontrei essa call.');
    const perms = canal.permissionsFor(client.user);
    if (!perms?.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) throw falha(`O ${ROTULO} não tem permissão para entrar e falar em <#${canal.id}>.`);
    if (canal.full && !perms.has(PermissionFlagsBits.MoveMembers)) throw falha(`A call <#${canal.id}> está cheia.`);
    let player;
    try {
      player = await shoukaku.joinVoiceChannel({ guildId: m.guildId, channelId: m.voiceChannelId, shardId: guild.shardId ?? 0, deaf: true });
    } catch (erro) {
      await shoukaku.leaveVoiceChannel(m.guildId).catch(() => {});
      console.error(`[${ROTULO}] Não consegui entrar na call:`, erro?.message || erro);
      throw falha('Não consegui entrar na call. Tente de novo.');
    }
    const s = {
      sid: ++seq, guildId: m.guildId, voiceChannelId: m.voiceChannelId, player, fila: [], atual: null,
      repetir: 'off', volume: VOLUME_PADRAO, tocadas: 0, relogio: { base: 0, desde: null }, aviso: null, timers: {},
    };
    player.on('end', (d) => aoFimFaixa(s, d));
    player.on('exception', (d) => {
      const motivo = d?.exception?.message || 'erro ao tocar';
      console.error(`[${ROTULO}] Erro ao tocar "${s.atual?.titulo}":`, motivo);
      s.aviso = { titulo: s.atual?.titulo || 'música', motivo: TRADUCOES.find(([p]) => p.test(motivo))?.[1] || motivo, quando: Date.now() };
    });
    player.on('stuck', () => s.player.stopTrack().catch(() => {}));
    player.on('update', (d) => {
      const p = d?.state?.position;
      if (typeof p === 'number' && s.atual) s.relogio = { base: p, desde: s.player.paused ? null : Date.now() };
    });
    sessoes.set(m.guildId, s);
    if (VOLUME_PADRAO !== 100) await player.setGlobalVolume(VOLUME_PADRAO).catch(() => {});
    verificarVazio(s);
    return s;
  }

  async function tocar(m) {
    let s = sessoes.get(m.guildId);
    if (s && s.voiceChannelId !== m.voiceChannelId) return responder(m.req, { ok: false, erro: `O ${ROTULO} já está tocando em <#${s.voiceChannelId}>.` });
    try {
      const no = noLavalink();
      const { faixas, playlist } = m.faixas ? await prepararFaixas(no, m.faixas) : await buscar(no, m.busca);
      if (!faixas.length) throw falha('Não encontrei nada para tocar.');
      if (!s) s = await criarSessao(m);
      const espaco = MAX_FILA - s.fila.length;
      if (espaco <= 0) throw falha(`A fila está cheia (${MAX_FILA} músicas).`);
      const lote = faixas.slice(0, espaco).map((f) => ({ ...f, uid: ++seq, pedidoPor: m.solicitante }));
      if (m.proxima) s.fila.unshift(...lote);
      else s.fila.push(...lote);
      const posicaoNaFila = m.proxima ? 1 : s.fila.length - lote.length + 1;
      const iniciou = !s.atual;
      if (iniciou) await proxima(s);
      else enviarEstado(s);
      responder(m.req, {
        ok: true,
        dados: { primeira: semEncoded(lote[0]), total: lote.length, cortadas: faixas.length - lote.length, playlist: playlist || null, posicao: posicaoNaFila, iniciou },
      });
    } catch (erro) {
      if (s && !s.atual && !s.fila.length && s.tocadas === 0) await encerrar(s, 'erro');
      responder(m.req, { ok: false, erro: mensagemErro(erro) });
    }
  }

  function embaralhar(lista) {
    for (let i = lista.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lista[i], lista[j]] = [lista[j], lista[i]];
    }
  }

  async function controle(m) {
    const s = sessoes.get(m.guildId);
    if (!s) return responder(m.req, { ok: false, erro: 'Não tem nada tocando agora.' });
    try {
      if (m.acao === 'parar') {
        await encerrar(s, 'parado');
        return responder(m.req, { ok: true });
      }
      if (m.acao === 'pausa') {
        if (!s.atual) throw falha('Não tem música tocando para pausar.');
        const pausar = !s.player.paused;
        await s.player.setPaused(pausar);
        ajustarRelogio(s, pausar);
      } else if (m.acao === 'pular') {
        if (!s.atual) throw falha('Não tem música tocando para pular.');
        await s.player.stopTrack();
      } else if (m.acao === 'volume') {
        const volume = limitar(Math.round(Number(m.valor) || 0), 0, VOLUME_MAX);
        await s.player.setGlobalVolume(volume);
        s.volume = volume;
      } else if (m.acao === 'repetir') s.repetir = REPETIR[s.repetir].proximo;
      else if (m.acao === 'embaralhar') embaralhar(s.fila);
      else if (m.acao === 'remover') {
        const indice = s.fila.findIndex((f) => f.uid === Number(m.valor));
        if (indice < 0) throw falha('Essa música já saiu da fila.');
        s.fila.splice(indice, 1);
      } else if (m.acao === 'limpar') s.fila = [];
      else throw falha('Ação desconhecida.');
      enviarEstado(s);
      responder(m.req, { ok: true });
    } catch (erro) {
      responder(m.req, { ok: false, erro: mensagemErro(erro) });
    }
  }

  function aoMudarVoz(antes, depois) {
    const guildId = depois.guild?.id ?? antes.guild?.id;
    const s = sessoes.get(guildId);
    if (!s || s.encerrada) return;
    if (depois.id === client.user.id) {
      if (!depois.channelId) return encerrar(s, 'desconectado');
      if (depois.channelId !== s.voiceChannelId) {
        s.voiceChannelId = depois.channelId;
        enviarEstado(s);
      }
      return verificarVazio(s);
    }
    if (antes.channelId === s.voiceChannelId || depois.channelId === s.voiceChannelId) verificarVazio(s);
  }

  const avisarServidores = () => enviar({ t: 'guilds', guilds: [...client.guilds.cache.keys()] });

  client.once(Events.ClientReady, () => {
    console.log(`[${ROTULO}] Online como ${client.user.tag}`);
    enviar({ t: 'pronto', nome: NOME, id: client.application?.id ?? client.user.id, avatar: client.user.displayAvatarURL({ size: 256 }), guilds: [...client.guilds.cache.keys()] });
  });
  client.on(Events.GuildCreate, avisarServidores);
  client.on(Events.GuildDelete, (guild) => {
    const s = sessoes.get(guild.id);
    if (s) encerrar(s, 'removido');
    avisarServidores();
  });
  client.on(Events.VoiceStateUpdate, aoMudarVoz);

  setInterval(() => {
    for (const s of sessoes.values()) {
      if (s.atual && !s.player.paused) enviar({ t: 'posicao', guildId: s.guildId, posicao: posicao(s), momento: Date.now() });
    }
  }, PAINEL_MS);

  aoReceber((m) => {
    if (m?.t === 'tocar') serial(m.guildId, () => tocar(m)).catch((e) => responder(m.req, { ok: false, erro: mensagemErro(e) }));
    else if (m?.t === 'controle') controle(m).catch((e) => responder(m.req, { ok: false, erro: mensagemErro(e) }));
  });

  client.login(env.DISCORD_TOKEN);
  return { client, shoukaku, sessoes };
}

if (require.main === module) {
  if (cluster.isPrimary) iniciarGerente();
  else iniciarClone();
}