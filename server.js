import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import yts from 'yt-search';
import { Client } from '@xhayper/discord-rpc';
import { fileURLToPath } from 'node:url';

// Pastas: APP_DIR = onde estão os arquivos do Sonora; DATA_DIR = onde salvar configurações.
// No app de desktop, DATA_DIR é a pasta do usuário (a pasta de instalação não aceita escrita).
const APP_DIR = (process.env.SONORA_APP_DIR || path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = process.env.SONORA_DATA_DIR || process.cwd();
const fromApp = (...p) => path.join(APP_DIR, ...p).replace(/app\.asar([\\/])/, 'app.asar.unpacked$1');
fs.mkdirSync(DATA_DIR, { recursive: true });

// carrega .env simples
const ENV_FILE = path.join(DATA_DIR, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const app = express();
app.use(express.json());

// ---------- Busca no YouTube ----------
app.get('/api/search', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    const r = await yts(q);
    res.json(r.videos.slice(0, 25).map(v => ({
      id: v.videoId, title: v.title, author: v.author?.name || '',
      duration: v.seconds, thumbnail: `https://i.ytimg.com/vi/${v.videoId}/hqdefault.jpg`,
    })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Biblioteca local ----------
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
const AUDIO_EXT = new Set(['.mp3', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.wma']);
const loadSettings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return { folders: [] }; } };
const saveSettings = s => fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s, null, 2));
let localTracks = new Map(); // id -> { ...meta, file }
let scanning = false;

function* walk(dir, depth = 0) {
  if (depth > 12) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p, depth + 1);
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) yield p;
  }
}
const idFor = file => 'local_' + Buffer.from(file).toString('base64url');

async function scanLibrary() {
  if (scanning) return;
  scanning = true;
  const { parseFile } = await import('music-metadata');
  const next = new Map();
  for (const folder of loadSettings().folders) {
    for (const file of walk(folder)) {
      const id = idFor(file);
      const old = localTracks.get(id);
      if (old) { next.set(id, old); continue; }
      let meta = {};
      try { meta = await parseFile(file, { duration: true, skipCovers: false }); } catch {}
      const c = meta.common || {};
      next.set(id, {
        id, source: 'local', file, folder,
        title: c.title || path.basename(file, path.extname(file)),
        author: c.artist || c.albumartist || 'Artista desconhecido',
        album: c.album || '',
        duration: Math.round(meta.format?.duration || 0),
        hasCover: !!c.picture?.length,
        thumbnail: c.picture?.length ? `/api/local/cover/${id}` : null,
      });
    }
  }
  localTracks = next;
  scanning = false;
  console.log(`[local] ${localTracks.size} músicas locais`);
}
scanLibrary();

const publicTrack = ({ file, folder, hasCover, ...t }) => t;
app.get('/api/settings', (_req, res) => res.json({ ...loadSettings(), scanning, count: localTracks.size }));
app.post('/api/settings/folders', async (req, res) => {
  const folders = [...new Set((req.body.folders || []).map(f => String(f).trim()).filter(Boolean))];
  const bad = folders.filter(f => !fs.existsSync(f) || !fs.statSync(f).isDirectory());
  if (bad.length) return res.status(400).json({ error: `Pasta não encontrada: ${bad.join(', ')}` });
  saveSettings({ ...loadSettings(), folders });
  await scanLibrary();
  res.json({ folders, count: localTracks.size });
});
app.post('/api/settings/rescan', async (_req, res) => { localTracks = new Map(); await scanLibrary(); res.json({ count: localTracks.size }); });
app.post('/api/settings/pick-folder', (_req, res) => {
  // Abre o seletor de pastas nativo do Windows
  if (process.platform !== 'win32') return res.json({ path: null });
  const ps = `Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Escolha uma pasta de músicas'; $f = New-Object System.Windows.Forms.Form -Property @{TopMost=$true}; if ($d.ShowDialog($f) -eq 'OK') { [Console]::OutputEncoding=[Text.Encoding]::UTF8; Write-Output $d.SelectedPath }`;
  import('node:child_process').then(({ execFile }) => {
    execFile('powershell.exe', ['-NoProfile', '-STA', '-Command', ps], { windowsHide: false }, (_e, out) => res.json({ path: String(out || '').trim() || null }));
  });
});
app.get('/api/local/tracks', (_req, res) => res.json([...localTracks.values()].map(publicTrack).sort((a, b) => a.author.localeCompare(b.author) || a.title.localeCompare(b.title))));
app.get('/api/local/stream/:id', (req, res) => {
  const t = localTracks.get(req.params.id);
  if (!t) return res.sendStatus(404);
  res.sendFile(t.file); // suporta Range automaticamente
});
app.get('/api/local/cover/:id', async (req, res) => {
  const t = localTracks.get(req.params.id);
  if (!t) return res.sendStatus(404);
  try {
    const { parseFile } = await import('music-metadata');
    const pic = (await parseFile(t.file)).common.picture?.[0];
    if (!pic) return res.sendStatus(404);
    res.set('Cache-Control', 'max-age=86400').type(pic.format).send(Buffer.from(pic.data));
  } catch { res.sendStatus(404); }
});

// ---------- Recomendações para a Home ----------
const DEFAULT_SEEDS = ['top hits brasil', 'sertanejo mais tocadas', 'funk mais tocadas', 'pop internacional hits', 'rock clássico', 'lofi beats'];
const homeCache = new Map();
async function searchCached(q) {
  const hit = homeCache.get(q);
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.v;
  const r = await yts(q);
  let vids = r.videos.filter(x => x.seconds > 60 && x.seconds < 1500);
  if (vids.length < 6) vids = r.videos.filter(x => x.seconds > 60);
  const v = vids.slice(0, 12).map(x => ({
    id: x.videoId, title: x.title, author: x.author?.name || '',
    duration: x.seconds, thumbnail: `https://i.ytimg.com/vi/${x.videoId}/hqdefault.jpg`,
  }));
  homeCache.set(q, { t: Date.now(), v });
  return v;
}

// Playlists e álbuns (mixes "RD…" do YouTube não podem ser abertos)
const isOpenableList = id => /^(PL|OLAK5uy_|OL)/.test(id);
const listKind = (id, title = '') => (id.startsWith('OLAK5uy_') || /^(album|álbum)\s*[-–:]/i.test(title) ? 'album' : 'playlist');
async function searchPlaylistsCached(q) {
  const key = 'pl:' + q;
  const hit = homeCache.get(key);
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return hit.v;
  const r = await yts(q);
  const v = r.playlists.filter(p => isOpenableList(p.listId)).slice(0, 6).map(p => ({
    listId: p.listId, kind: listKind(p.listId, p.title),
    title: p.title.replace(/^(album|álbum)\s*[-–:]\s*/i, ''),
    author: /subscribers|inscritos/i.test(p.author?.name || '') ? '' : (p.author?.name || ''),
    count: p.videoCount || 0, thumbnail: p.thumbnail || p.image,
  }));
  homeCache.set(key, { t: Date.now(), v });
  return v;
}

let ytPromise;
const getYT = () => (ytPromise ||= import('youtubei.js').then(({ Innertube }) => Innertube.create({ retrieve_player: false, lang: 'pt', location: 'BR' })));
const parseDur = s => (s ? String(s).split(':').reduce((a, b) => a * 60 + (+b || 0), 0) : 0);
function parsePlaylistItem(v) {
  if (v.type === 'LockupView') {
    if (v.content_type !== 'VIDEO') return null;
    const rows = v.metadata?.metadata?.metadata_rows || [];
    const badge = (v.content_image?.overlays || []).flatMap(o => o.badges || []).find(b => /\d:\d/.test(b.text || ''));
    return {
      id: v.content_id, title: v.metadata?.title?.toString() || '',
      author: rows[0]?.metadata_parts?.[0]?.text?.toString() || '',
      duration: parseDur(badge?.text), thumbnail: `https://i.ytimg.com/vi/${v.content_id}/hqdefault.jpg`,
    };
  }
  if (v.id) {
    return {
      id: v.id, title: v.title?.toString() || '', author: v.author?.name || '',
      duration: v.duration?.seconds || 0, thumbnail: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`,
    };
  }
  return null;
}
const playlistCache = new Map();
app.get('/api/playlist/:id', async (req, res) => {
  const id = req.params.id;
  if (!isOpenableList(id)) return res.status(400).json({ error: 'Este tipo de playlist não pode ser aberto.' });
  const hit = playlistCache.get(id);
  if (hit && Date.now() - hit.t < 30 * 60 * 1000) return res.json(hit.v);
  try {
    const yt = await getYT();
    let pl = await yt.getPlaylist(id);
    const items = [...pl.items];
    while (pl.has_continuation && items.length < 300) { pl = await pl.getContinuation(); items.push(...pl.items); }
    const tracks = items.map(parsePlaylistItem).filter(t => t?.id && t.title && !/^\[(private|deleted)/i.test(t.title));
    const i = pl.info || {};
    const title = (i.title || '').replace(/^(album|álbum)\s*[-–:]\s*/i, '');
    const v = {
      listId: id, kind: listKind(id, i.title), title,
      author: (i.author?.name || '').replace(/^by\s+|^de\s+|^por\s+/i, ''),
      description: (i.description || '').slice(0, 300),
      views: i.views || '',
      thumbnail: tracks[0]?.thumbnail || i.thumbnails?.[0]?.url,
      tracks,
    };
    playlistCache.set(id, { t: Date.now(), v });
    res.json(v);
  } catch (e) {
    res.status(500).json({ error: 'Não foi possível abrir a playlist: ' + e.message });
  }
});
app.get('/api/home', async (req, res) => {
  const artists = String(req.query.artists || '').split('|').map(s => s.trim()).filter(Boolean).slice(0, 3);
  const genres = req.query.genres !== undefined
    ? String(req.query.genres).split('|').map(s => s.trim()).filter(Boolean).slice(0, 10)
    : null;
  const genreSections = genres
    ? genres.map(g => ({ title: g, q: `${g} mais tocadas` }))
    : DEFAULT_SEEDS.slice(0, 6 - Math.min(artists.length, 2)).map(q => ({ title: q[0].toUpperCase() + q.slice(1), q }));
  const sections = [
    ...artists.map(a => ({ title: `Porque você curtiu ${a}`, q: `${a} mix`, pq: `${a} álbum` })),
    ...genreSections.map(s => ({ ...s, pq: `${s.title} playlist` })),
  ];
  const out = [];
  for (let i = 0; i < sections.length; i += 2) {
    const batch = await Promise.all(sections.slice(i, i + 2).map(async s => {
      for (let tries = 0; tries < 2; tries++) {
        try {
          const [tracks, playlists] = await Promise.all([searchCached(s.q), searchPlaylistsCached(s.pq).catch(() => [])]);
          return { title: s.title, tracks, playlists };
        } catch {}
      }
      return null;
    }));
    out.push(...batch);
  }
  res.json(out.filter(s => s?.tracks.length));
});

// ---------- Letras (LRCLIB) ----------
function cleanTitle(title, author) {
  let t = title.replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/\b(official|oficial|video|vídeo|clipe|clip|lyrics?|letra|audio|áudio|hd|4k|mv|visualizer|ao vivo|live)\b/gi, ' ')
    .replace(/[|•].*$/, ' ').replace(/\s+/g, ' ').trim();
  let artist = author.replace(/\s*-\s*Topic$|VEVO$|Oficial$|Official$/i, '').trim();
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) { artist = m[1].trim(); t = m[2].trim(); }
  return { track: t.replace(/\s*(ft|feat)\.?\s.*$/i, '').trim(), artist };
}
app.get('/api/lyrics', async (req, res) => {
  const { track, artist } = cleanTitle(String(req.query.title || ''), String(req.query.author || ''));
  const duration = Number(req.query.duration) || 0;
  const headers = { 'User-Agent': 'Sonora/1.0 (local music player)' };
  try {
    const r = await fetch(`https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`, { headers });
    let list = r.ok ? await r.json() : [];
    if (!list.length) {
      const r2 = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${track}`)}`, { headers });
      list = r2.ok ? await r2.json() : [];
    }
    const score = x => (x.syncedLyrics ? 0 : 1000) + (duration ? Math.abs((x.duration || 0) - duration) : 0);
    list = list.filter(x => x.syncedLyrics || x.plainLyrics).sort((a, b) => score(a) - score(b));
    const best = list[0];
    if (!best) return res.json({ found: false, track, artist });
    const synced = best.syncedLyrics
      ? best.syncedLyrics.split('\n').map(l => {
          const m = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
          return m ? { t: +m[1] * 60 + +m[2], text: m[3] } : null;
        }).filter(Boolean)
      : null;
    res.json({ found: true, track: best.trackName, artist: best.artistName, synced, plain: best.plainLyrics || null });
  } catch (e) {
    res.json({ found: false, error: e.message });
  }
});

// ---------- Discord Rich Presence ----------
let rpc = null, rpcReady = false, rpcError = '', rpcUser = '', retryTimer = null, connecting = false;
// Application ID do app "Sonora" no Discord. É um identificador público (não é senha nem segredo):
// o Rich Presence só precisa dele. Quem quiser pode trocar em Configurações → Discord.
const DEFAULT_DISCORD_CLIENT_ID = '1569822693581258834';
const discordCfg = () => {
  const s = loadSettings();
  const custom = (s.discordClientId || process.env.DISCORD_CLIENT_ID || '').trim();
  return { enabled: s.discordEnabled !== false, clientId: custom || DEFAULT_DISCORD_CLIENT_ID, isDefault: !custom };
};

async function disconnectRpc() {
  clearTimeout(retryTimer);
  const old = rpc; rpc = null; rpcReady = false; rpcUser = '';
  if (old) { try { old.removeAllListeners(); await old.user?.clearActivity(); } catch {} try { await old.destroy(); } catch {} }
}
async function connectRpc() {
  clearTimeout(retryTimer);
  const { enabled, clientId } = discordCfg();
  if (!enabled) { rpcError = ''; return false; }
  if (!clientId) { rpcError = 'Application ID não configurado'; console.log('[discord]', rpcError); return false; }
  if (connecting) return false;
  connecting = true;
  await disconnectRpc();
  const c = new Client({ clientId });
  rpc = c;
  c.on('ready', () => { rpcReady = true; rpcError = ''; rpcUser = c.user?.username || ''; console.log('[discord] conectado como', rpcUser); });
  c.on('disconnected', () => {
    if (rpc !== c) return;
    rpcReady = false; rpcError = 'Conexão com o Discord perdida';
    retryTimer = setTimeout(connectRpc, 15000);
  });
  try {
    await c.login();
  } catch (e) {
    rpcReady = false;
    rpcError = /ENOENT|ECONNREFUSED|Could not connect|connection/i.test(e.message) ? 'Discord não está aberto neste computador' : e.message;
    console.log('[discord] não conectou:', rpcError);
    retryTimer = setTimeout(connectRpc, 15000);
  } finally { connecting = false; }
  return rpcReady;
}
connectRpc();

const discordStatus = () => {
  const { enabled, clientId, isDefault } = discordCfg();
  return { enabled, clientId: isDefault ? '' : clientId, isDefault, configured: !!clientId, connected: rpcReady, user: rpcUser, error: rpcReady ? '' : rpcError };
};
app.get('/api/presence/status', (_req, res) => res.json(discordStatus()));
app.post('/api/presence/settings', async (req, res) => {
  const s = loadSettings();
  if (req.body.enabled !== undefined) s.discordEnabled = !!req.body.enabled;
  if (req.body.clientId !== undefined) {
    const id = String(req.body.clientId).trim();
    if (id && !/^\d{15,22}$/.test(id)) return res.status(400).json({ error: 'Application ID inválido (deve ter só números).' });
    s.discordClientId = id;
  }
  saveSettings(s);
  if (s.discordEnabled === false) await disconnectRpc(); else await connectRpc();
  res.json(discordStatus());
});
app.post('/api/presence/reconnect', async (_req, res) => { await connectRpc(); res.json(discordStatus()); });

app.post('/api/presence', async (req, res) => {
  if (!rpcReady) return res.json({ ok: false });
  const { title, author, thumbnail, duration, position, paused, id } = req.body || {};
  try {
    if (!title) { await rpc.user?.clearActivity(); return res.json({ ok: true }); }
    const now = Date.now();
    const act = {
      type: 2, // "Ouvindo"
      statusDisplayType: 2, // mostra o título da música na lista de membros
      details: String(title).slice(0, 128),
      state: (author ? `por ${author}` : 'YouTube').slice(0, 128),
      largeImageKey: /^https?:/.test(thumbnail || '') ? thumbnail : undefined,
      largeImageText: String(title).slice(0, 128),
      smallImageText: paused ? 'Pausado' : 'Tocando',
      buttons: id && !String(id).startsWith('local_') ? [{ label: 'Ouvir no YouTube', url: `https://www.youtube.com/watch?v=${id}` }] : undefined,
    };
    if (!paused && duration) {
      act.startTimestamp = now - position * 1000;
      act.endTimestamp = now + (duration - position) * 1000;
    }
    if (paused) act.state = `⏸ ${act.state}`.slice(0, 128);
    await rpc.user?.setActivity(act);
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ---------- Teclas multimídia do teclado (Windows) ----------
// Um script PowerShell reserva só as teclas de mídia e avisa aqui; repassamos para a página via SSE.
const eventClients = new Set();
let mediaKeys = { enabled: false, active: false, failed: [], error: '' };
let mkProc = null;

function sendEvent(type, data) {
  // só a página aberta mais recentemente reage, para não tocar/pausar em duas abas
  const last = [...eventClients].at(-1);
  if (last) last.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function startMediaKeys() {
  stopMediaKeys();
  const enabled = loadSettings().mediaKeys !== false;
  mediaKeys = { enabled, active: false, failed: [], error: '' };
  if (!enabled) return;
  if (process.platform !== 'win32') { mediaKeys.error = 'Disponível só no Windows'; return; }
  const { spawn } = await import('node:child_process');
  const script = fromApp('scripts', 'mediakeys.ps1');
  const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  mkProc = p;
  let buf = '';
  p.stdout.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      const [kind, name] = line.split(' ');
      if (kind === 'ok') mediaKeys.active = true;
      else if (kind === 'fail') mediaKeys.failed.push(name);
      else if (kind === 'key') sendEvent('mediakey', { action: name });
    }
  });
  p.stderr.on('data', d => { mediaKeys.error = d.toString().trim().split('\n')[0].slice(0, 200); });
  p.on('exit', () => {
    if (mkProc !== p) return;
    mkProc = null; mediaKeys.active = false;
    if (!mediaKeys.error) mediaKeys.error = 'O leitor de teclas multimídia parou';
  });
  // Se outro programa (ou outro Sonora) estiver com alguma tecla, tenta de novo a cada 20 s até conseguir
  mkRetry = setTimeout(() => {
    if (mkProc !== p || !mediaKeys.failed.length) return;
    const failed = [...mediaKeys.failed];
    stopMediaKeys();
    mediaKeys = { enabled: true, active: false, failed, error: 'Outro programa está usando essas teclas; tentando de novo…' };
    mkRetry = setTimeout(startMediaKeys, 20000);
  }, 4000);
}
let mkRetry = null;
function stopMediaKeys() {
  clearTimeout(mkRetry);
  if (mkProc) { const p = mkProc; mkProc = null; try { p.stdin.end(); } catch {} setTimeout(() => { try { p.kill(); } catch {} }, 1500); }
}
startMediaKeys();
process.on('exit', () => { try { mkProc?.kill(); } catch {} });
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { stopMediaKeys(); setTimeout(() => process.exit(0), 300); });

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  eventClients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); eventClients.delete(res); });
});
app.get('/api/mediakeys', (_req, res) => res.json(mediaKeys));
app.post('/api/mediakeys', async (req, res) => {
  saveSettings({ ...loadSettings(), mediaKeys: !!req.body.enabled });
  await startMediaKeys();
  setTimeout(() => res.json(mediaKeys), 2500); // tempo para o PowerShell registrar as teclas
});

// ---------- produção ----------
const dist = path.join(APP_DIR, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const PORT = process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 3001;
let resolveReady;
export const ready = new Promise(r => { resolveReady = r; });
export { sendEvent };
const httpServer = app.listen(PORT, '0.0.0.0', async () => {
  const port = httpServer.address().port;
  resolveReady(port);
  const os = await import('node:os');
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter(i => i && i.family === 'IPv4' && !i.internal && !/^169\.254\./.test(i.address)).map(i => i.address);
  console.log(`Sonora rodando em http://localhost:${port}`);
  for (const ip of lan) console.log(`No celular (mesmo Wi-Fi): http://${ip}:${port}`);
});
