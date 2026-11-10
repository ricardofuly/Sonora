import { useEffect, useMemo, useRef, useState } from 'react';
import { usePlayer } from './usePlayer.js';
import { useNativePlayer } from './useNativePlayer.js';
import { isNative, Sonora } from './native.js';
import { searchTracks, loadHome as apiHome, loadPlaylist, loadLyrics } from './api.js';
import { REPO, APP_VERSION, isDesktop, checkMobileUpdate, confirmBundleWorks, downloadWebUpdate, activateWebUpdate, installApkUpdate } from './updates.js';
import {
  House, Search, Library, Plus, Music2, Play, Pause, SkipBack, SkipForward, Shuffle, Repeat, Volume2, Volume1, VolumeX,
  MicVocal, X, ChevronLeft, ListMusic, Folder, FolderPlus, Check, Settings as SettingsIcon, RefreshCw, Heart, AudioLines,
  CircleAlert, CircleCheck, PanelLeftClose, PanelLeftOpen, ChevronDown, Download, Minus, Copy as RestoreIcon, Square, CircleCheckBig, LoaderCircle, Gauge, Keyboard, Trash2, ListPlus, Disc3, Palette, Radio, Ellipsis, Clock3,
} from 'lucide-react';
import { THEMES, ACCENTS, DEFAULT_APPEARANCE, applyAppearance } from './themes.js';

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const DEFAULT_GENRES = ['Top hits Brasil', 'Sertanejo', 'Funk', 'Pop internacional', 'Rock clássico', 'Lofi'];
const GENRE_CATALOG = ['Top hits Brasil', 'Sertanejo', 'Funk', 'Pagode', 'Samba', 'MPB', 'Forró', 'Piseiro', 'Axé', 'Gospel',
  'Rap nacional', 'Trap', 'Hip hop', 'Pop internacional', 'K-pop', 'Rock clássico', 'Rock nacional', 'Metal', 'Indie',
  'Eletrônica', 'House', 'Reggae', 'Reggaeton', 'Jazz', 'Blues', 'R&B', 'Lofi', 'Clássica', 'Anos 80', 'Anos 90', 'Trilhas de games', 'Anime'];

function Cover({ src, big, onClick }) {
  const [err, setErr] = useState(false);
  useEffect(() => setErr(false), [src]);
  if (!src || err) return <div className={`cover-ph ${big ? 'big' : ''}`} onClick={onClick}><Music2 size={big ? 22 : 18} /></div>;
  return <img src={src} alt="" onClick={onClick} onError={() => setErr(true)} />;
}

// Capa de uma playlist do usuário: mosaico 2×2 com 4+ capas diferentes, senão a primeira capa
function PlaylistCover({ tracks = [], className = '' }) {
  const thumbs = [...new Set(tracks.map(t => t.thumbnail).filter(Boolean))].slice(0, 4);
  if (thumbs.length >= 4) {
    return <span className={`pl-cover mosaic ${className}`}>{thumbs.map(src => <img key={src} src={src} alt="" loading="lazy" />)}</span>;
  }
  if (thumbs.length) return <span className={`pl-cover ${className}`}><img src={thumbs[0]} alt="" loading="lazy" /></span>;
  return <span className={`pl-cover empty ${className}`}><ListMusic size={16} /></span>;
}

// Animação de carregamento: disco de vinil girando com braço + equalizador e notas flutuando
function MusicLoader({ text = 'Carregando…' }) {
  return (
    <div className="mloader" role="status" aria-live="polite">
      <div className="ml-stage">
        <div className="ml-vinyl"><span className="ml-label" /></div>
        <div className="ml-arm" />
        <Music2 className="ml-note n1" size={16} /><Music2 className="ml-note n2" size={13} /><Music2 className="ml-note n3" size={15} />
      </div>
      <div className="ml-eq">{Array.from({ length: 7 }, (_, i) => <span key={i} style={{ '--i': i }} />)}</div>
      <p>{text}</p>
    </div>
  );
}

function SkeletonShelf({ cards = 5 }) {
  return (
    <section className="shelf skel" aria-hidden="true">
      <div className="sk sk-title" />
      <div className="cards">
        {Array.from({ length: cards }, (_, i) => (
          <div key={i} className="card"><div className="sk sk-cover" /><div className="sk sk-line" /><div className="sk sk-line short" /></div>
        ))}
      </div>
    </section>
  );
}

function SkeletonRows({ rows = 6 }) {
  return (
    <div className="tracks skel" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="track sk-row"><div className="sk sk-thumb" /><div><div className="sk sk-line" /><div className="sk sk-line short" /></div></div>
      ))}
    </div>
  );
}

// Player em tela cheia (celular)
function FullPlayer({ track, player, onClose, next, prev, shuffle, setShuffle, repeat, setRepeat, liked, onLike, lyrics, onKaraoke, source, onGoSource }) {
  const startY = useRef(null);
  const [drag, setDrag] = useState(0);
  // arrastar para baixo fecha
  const onTouchStart = e => { startY.current = e.touches[0].clientY; };
  const onTouchMove = e => { if (startY.current != null) setDrag(Math.max(0, e.touches[0].clientY - startY.current)); };
  const onTouchEnd = () => { if (drag > 120) onClose(); setDrag(0); startY.current = null; };
  return (
    <div className="fullplayer" style={{ '--bg-img': track.thumbnail ? `url(${track.thumbnail})` : 'none', transform: drag ? `translateY(${drag}px)` : undefined }}
      role="dialog" aria-label="Tocando agora">
      <div className="fp-head" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        <button className="icon" onClick={onClose} title="Minimizar"><ChevronDown size={26} /></button>
        <button className="fp-source" onClick={onGoSource} disabled={!source} title="Abrir a lista que está tocando">
          <small>{source ? 'Tocando de' : 'Tocando agora'}</small>
          {source && <b>{source.label}</b>}
        </button>
        <span style={{ width: 34 }} />
      </div>
      <div className="fp-cover" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {track.thumbnail ? <img src={track.thumbnail} alt="" /> : <div className="cover-ph"><Music2 size={64} /></div>}
      </div>
      <div className="fp-info">
        <div className="fp-text"><div className="t">{track.title}</div><div className="a">{track.author}</div></div>
        <button className={`icon ${liked ? 'liked' : ''}`} onClick={onLike} title={liked ? 'Remover da biblioteca' : 'Salvar na biblioteca'}><Heart size={24} fill={liked ? 'currentColor' : 'none'} /></button>
      </div>
      <div className="fp-progress">
        <input type="range" min="0" max={player.duration || 1} step="1" value={player.time} onChange={e => player.seek(+e.target.value)}
          style={{ '--fill': `${player.duration ? (player.time / player.duration) * 100 : 0}%` }} aria-label="Posição da música" />
        <div className="fp-times"><span>{fmt(player.time)}</span><span>{fmt(player.duration)}</span></div>
      </div>
      <div className="fp-controls">
        <button className={`icon ${shuffle ? 'liked' : ''}`} onClick={() => setShuffle(s => !s)} title="Aleatório"><Shuffle size={22} /></button>
        <button className="icon lg" onClick={prev} title="Anterior"><SkipBack size={30} fill="currentColor" /></button>
        <button className="fp-play" onClick={player.toggle} title={player.playing ? 'Pausar' : 'Tocar'}>{player.playing ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" className="nudge" />}</button>
        <button className="icon lg" onClick={next} title="Próxima"><SkipForward size={30} fill="currentColor" /></button>
        <button className={`icon ${repeat ? 'liked' : ''}`} onClick={() => setRepeat(r => !r)} title="Repetir"><Repeat size={22} /></button>
      </div>
      <div className="fp-extra">
        <button className={`ghost ${lyrics?.found ? '' : 'dim'}`} onClick={onKaraoke}><MicVocal size={17} /> {lyrics?.found ? 'Karaokê' : 'Letra indisponível'}</button>
      </div>
    </div>
  );
}

function AppearancePanel({ appearance: a, setAppearance }) {
  const set = patch => setAppearance(x => ({ ...x, ...patch }));
  return (
    <section className="panel">
      <h2><Palette size={18} /> Aparência</h2>
      <p className="muted">Escolha um tema e uma cor de destaque. As mudanças aparecem na hora.</p>
      <h3>Tema</h3>
      <div className="themes">
        {Object.entries(THEMES).map(([k, t]) => (
          <button key={k} className={`theme-card ${a.theme === k ? 'on' : ''}`} onClick={() => set({ theme: k })} aria-pressed={a.theme === k}>
            <span className="theme-preview" style={{ background: t.bg, borderColor: t.border }}>
              <span style={{ background: t.panel }} />
              <span style={{ background: t.surface }}><i style={{ background: a.accent }} /><i style={{ background: t.muted }} /></span>
            </span>
            <span>{t.name}</span>
          </button>
        ))}
      </div>
      <h3>Cor de destaque</h3>
      <div className="swatches">
        {ACCENTS.map(c => (
          <button key={c.color} className={`swatch ${a.accent.toLowerCase() === c.color ? 'on' : ''}`} style={{ background: c.color }}
            title={c.name} aria-label={c.name} onClick={() => set({ accent: c.color })} />
        ))}
        <label className="swatch custom" title="Cor personalizada" style={{ background: ACCENTS.some(c => c.color === a.accent.toLowerCase()) ? undefined : a.accent }}>
          <input type="color" value={a.accent} onChange={e => set({ accent: e.target.value })} /><Plus size={16} strokeWidth={3} />
        </label>
      </div>
      <div className="opts">
        <div><h3>Cantos</h3>
          <div className="seg">{[['sharp', 'Retos'], ['rounded', 'Suaves'], ['round', 'Redondos']].map(([k, l]) =>
            <button key={k} className={a.radius === k ? 'on' : ''} onClick={() => set({ radius: k })}>{l}</button>)}</div>
        </div>
        <div><h3>Densidade das listas</h3>
          <div className="seg">{[['comfortable', 'Confortável'], ['compact', 'Compacta']].map(([k, l]) =>
            <button key={k} className={a.density === k ? 'on' : ''} onClick={() => set({ density: k })}>{l}</button>)}</div>
        </div>
        <div><h3>Efeitos</h3>
          <label className="switch"><input type="checkbox" checked={a.effects} onChange={e => set({ effects: e.target.checked })} /><span />Fundos com gradiente e desfoque</label>
        </div>
      </div>
      <button className="ghost" onClick={() => setAppearance(DEFAULT_APPEARANCE)}>Restaurar aparência padrão</button>
    </section>
  );
}

function UpdatesPanel({ showToast }) {
  const [st, setSt] = useState({ current: APP_VERSION, state: 'idle' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (isDesktop) {
      window.sonoraUpdates.get().then(setSt);
      return window.sonoraUpdates.onStatus(s => setSt(p => ({ ...p, ...s })));
    }
    if (isNative) Sonora.getAppInfo().then(i => setSt(p => ({ ...p, current: i.bundleVersion, native: i.versionName })));
  }, []);
  const check = async () => {
    setBusy(true);
    try {
      if (isDesktop) setSt(await window.sonoraUpdates.check());
      else if (isNative) {
        const u = await checkMobileUpdate();
        if (u.type === 'none') { setSt(p => ({ ...p, state: 'latest' })); showToast('Você já está na versão mais recente.', 'ok', 3000); }
        else if (u.type === 'web') {
          setSt(p => ({ ...p, state: 'downloading', version: u.version }));
          await downloadWebUpdate(u);
          setSt(p => ({ ...p, state: 'ready', version: u.version }));
        } else setSt(p => ({ ...p, state: 'apk', version: u.version, apk: u }));
      }
    } catch (e) { setSt(p => ({ ...p, state: 'error', error: e.message })); }
    finally { setBusy(false); }
  };
  const label = {
    idle: 'Atualizações automáticas ativadas', dev: 'Versão de desenvolvimento (sem atualização automática)',
    checking: 'Procurando atualizações…', latest: 'Você está na versão mais recente',
    downloading: `Baixando a versão ${st.version || ''}${st.progress ? ` (${Math.round(st.progress * 100)}%)` : ''}…`,
    ready: `Versão ${st.version} pronta para instalar`, apk: `Nova versão do app: ${st.version}`, error: `Erro: ${st.error || 'falha ao verificar'}`,
  }[st.state] || '';
  const install = () => {
    if (isDesktop) window.sonoraUpdates.install();
    else if (st.state === 'ready') activateWebUpdate();
    else if (st.apk) installApkUpdate(st.apk).then(r => r.status === 'needs-permission' && showToast('Permita "instalar apps desta fonte" para o Sonora e toque em Instalar de novo.', 'error', 12000));
  };
  return (
    <section className="panel">
      <h2><Download size={18} /> Atualizações</h2>
      <p className="muted">Versão instalada: <b>{st.current}</b>{st.native && st.native !== st.current ? ` (app ${st.native})` : ''}. {isDesktop || isNative
        ? 'O Sonora procura atualizações sozinho e baixa das releases do GitHub.'
        : 'Na versão do navegador, atualize o projeto com git pull e reinicie o servidor.'}</p>
      {(isDesktop || isNative) && <>
        <div className={`dstatus ${st.state === 'error' ? 'err' : st.state === 'ready' || st.state === 'apk' ? 'on' : ''}`}><span className="dot" />{label}</div>
        <div className="row">
          <button className="ghost" disabled={busy || st.state === 'dev'} onClick={check}><RefreshCw size={15} /> Verificar agora</button>
          {(st.state === 'ready' || st.state === 'apk') && <button className="btn" onClick={install}><Download size={15} /> {isDesktop ? 'Reiniciar e instalar' : 'Instalar agora'}</button>}
        </div>
      </>}
      <p className="muted small"><a href={`https://github.com/${REPO}/releases`} target="_blank" rel="noreferrer">Ver todas as versões</a> · <a href={`https://ricardofuly.github.io/Sonora/termos.html`} target="_blank" rel="noreferrer">Termos</a> · <a href={`https://ricardofuly.github.io/Sonora/privacidade.html`} target="_blank" rel="noreferrer">Privacidade</a></p>
    </section>
  );
}

function MediaKeysPanel({ showToast }) {
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/mediakeys').then(r => r.json()).then(setSt).catch(() => {}); }, []);
  const toggle = async enabled => {
    setBusy(true);
    try {
      const d = await (await fetch('/api/mediakeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) })).json();
      setSt(d);
      if (enabled && !d.active) showToast(`Teclas multimídia: ${d.error || 'outro programa já está usando essas teclas'}.`);
      else if (enabled) showToast('Teclas multimídia ativadas.', 'ok', 3000);
    } catch { showToast('Não foi possível falar com o servidor do Sonora.'); }
    finally { setBusy(false); }
  };
  const status = !st ? ['…', 'Verificando…'] : !st.enabled ? ['off', 'Desativado'] : st.active
    ? ['on', st.failed?.length ? `Ativo (exceto: ${st.failed.join(', ')})` : 'Ativo: play/pause, próxima, anterior e parar']
    : ['err', st.error || 'Não foi possível reservar as teclas'];
  return (
    <section className="panel">
      <h2><Keyboard size={18} /> Teclas multimídia</h2>
      <p className="muted">Controla o Sonora pelas teclas de mídia do teclado (▶❚❚, ⏭, ⏮, ⏹), mesmo com o navegador minimizado. Enquanto estiver ativo, essas teclas ficam reservadas para o Sonora.</p>
      <div className={`dstatus ${status[0]}`}><span className="dot" />{status[1]}</div>
      <label className="switch">
        <input type="checkbox" checked={!!st?.enabled} disabled={busy || !st} onChange={e => toggle(e.target.checked)} />
        <span />Usar as teclas multimídia do teclado
      </label>
    </section>
  );
}

function DiscordPanel({ discord, setDiscord, showToast }) {
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (discord?.clientId && !id) setId(discord.clientId); }, [discord?.clientId]);
  const call = async (url, body) => {
    setBusy(true);
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
      const d = await r.json();
      if (!r.ok) { showToast(d.error); return; }
      setDiscord(d);
      if (d.enabled && !d.connected) showToast(`Discord: ${d.error || 'não foi possível conectar'}.`);
      else if (d.connected) showToast(`Conectado ao Discord como ${d.user}.`, 'ok', 3500);
    } catch { showToast('Não foi possível falar com o servidor do Sonora.'); }
    finally { setBusy(false); }
  };
  const st = !discord ? ['…', 'Verificando…'] : !discord.enabled ? ['off', 'Desativado'] : discord.connected ? ['on', `Conectado como ${discord.user}`] : ['err', discord.error || 'Desconectado'];
  return (
    <section className="panel">
      <h2><Radio size={18} /> Discord</h2>
      <p className="muted">Mostra no seu perfil do Discord a música que você está ouvindo. O Discord precisa estar aberto neste computador.</p>
      <div className={`dstatus ${st[0]}`}><span className="dot" />{st[1]}</div>
      <label className="switch">
        <input type="checkbox" checked={!!discord?.enabled} disabled={busy || !discord} onChange={e => call('/api/presence/settings', { enabled: e.target.checked })} />
        <span />Mostrar o que estou ouvindo no Discord
      </label>
      <form className="row" onSubmit={e => { e.preventDefault(); call('/api/presence/settings', { clientId: id }); }}>
        <input value={id} onChange={e => setId(e.target.value)} placeholder="Application ID do Discord" inputMode="numeric" />
        <button className="btn" disabled={busy}>Salvar ID</button>
        <button type="button" className="ghost" disabled={busy || !discord?.enabled} onClick={() => call('/api/presence/reconnect')}><RefreshCw size={15} /> Reconectar</button>
      </form>
    </section>
  );
}

function DlBadge({ id, done, progress }) {
  if (done) return <span className="dl-badge done" title="Baixada"><CircleCheckBig size={13} /></span>;
  if (typeof progress === 'number') return <span className="dl-badge" title="Baixando"><LoaderCircle size={13} className="spin" /> {Math.round(progress * 100)}%</span>;
  return null;
}

function PlaybackPanel({ downloads, onClearDownloads }) {
  const [quality, setQuality] = useState(null);
  const [bytes, setBytes] = useState(0);
  useEffect(() => { Sonora.getSettings().then(s => { setQuality(s.quality); setBytes(s.downloadsBytes); }); }, [downloads.length]);
  const set = q => { setQuality(q); Sonora.setQuality({ quality: q }); };
  const mb = n => (n / 1048576).toFixed(n > 104857600 ? 0 : 1);
  return (
    <section className="panel">
      <h2><Gauge size={18} /> Reprodução e dados móveis</h2>
      <p className="muted">Qualidade do áudio ao tocar pela internet. Vale também para novos downloads.</p>
      <div className="seg">
        {[['low', 'Econômica'], ['normal', 'Normal'], ['high', 'Alta']].map(([k, l]) =>
          <button key={k} className={quality === k ? 'on' : ''} onClick={() => set(k)}>{l}</button>)}
      </div>
      <p className="muted small">Econômica ≈ 25 MB por hora · Normal ≈ 60 MB por hora · Alta ≈ 75 MB por hora</p>
      <h3>Downloads</h3>
      <p className="muted">{downloads.length} músicas baixadas ({mb(bytes)} MB). Elas tocam sem internet, ideal para correr longe do Wi-Fi.</p>
      <button className="ghost" disabled={!downloads.length} onClick={() => confirm('Apagar todas as músicas baixadas?') && onClearDownloads()}><Trash2 size={15} /> Apagar todos os downloads</button>
    </section>
  );
}

function Settings({ genres, setGenres, onLocalChange, appearance, setAppearance, discord, setDiscord, showToast, downloads = [], onClearDownloads }) {
  const [custom, setCustom] = useState('');
  const [folders, setFolders] = useState([]);
  const [count, setCount] = useState(0);
  const [newFolder, setNewFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { if (isNative) return; fetch('/api/settings').then(r => r.json()).then(s => { setFolders(s.folders || []); setCount(s.count || 0); }); }, []);

  const toggle = g => setGenres(gs => (gs.includes(g) ? gs.filter(x => x !== g) : [...gs, g]));
  const addCustom = e => { e.preventDefault(); const g = custom.trim(); if (g) setGenres(gs => (gs.includes(g) ? gs : [...gs, g])); setCustom(''); };
  const saveFolders = async list => {
    setBusy(true); setMsg('Escaneando músicas…');
    try {
      const r = await fetch('/api/settings/folders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folders: list }) });
      const d = await r.json();
      if (!r.ok) { setMsg(d.error); return; }
      setFolders(d.folders); setCount(d.count); setMsg(`${d.count} músicas encontradas.`); onLocalChange();
    } catch { setMsg('Erro ao salvar.'); } finally { setBusy(false); }
  };
  const pick = async () => {
    setMsg('Escolha a pasta na janela que abriu…');
    const { path } = await (await fetch('/api/settings/pick-folder', { method: 'POST' })).json();
    if (path) saveFolders([...folders, path]); else setMsg('');
  };
  const rescan = async () => { setBusy(true); setMsg('Escaneando…'); const d = await (await fetch('/api/settings/rescan', { method: 'POST' })).json(); setCount(d.count); setMsg(`${d.count} músicas encontradas.`); setBusy(false); onLocalChange(); };

  const all = [...new Set([...GENRE_CATALOG, ...genres])];
  return (
    <div className="settings">
      <div className="header"><h1>Configurações</h1></div>
      <AppearancePanel appearance={appearance} setAppearance={setAppearance} />

      <section className="panel">
        <h2><House size={18} /> Estilos na tela Início</h2>
        <p className="muted">Escolha quais estilos aparecem como prateleiras na Início ({genres.length} selecionados, até 10 aparecem).</p>
        <div className="chips">
          {all.map(g => <button key={g} className={`chip ${genres.includes(g) ? 'on' : ''}`} onClick={() => toggle(g)}>{genres.includes(g) && <Check size={14} strokeWidth={3} />}{g}</button>)}
        </div>
        <form className="row" onSubmit={addCustom}>
          <input value={custom} onChange={e => setCustom(e.target.value)} placeholder="Outro estilo ou artista (ex.: Synthwave)" />
          <button className="btn">Adicionar</button>
          <button type="button" className="ghost" onClick={() => setGenres(DEFAULT_GENRES)}>Restaurar padrão</button>
        </form>
      </section>

      {isNative && <PlaybackPanel downloads={downloads} onClearDownloads={onClearDownloads} />}

      {!isNative && <section className="panel">
        <h2><Folder size={18} /> Músicas locais</h2>
        <p className="muted">Pastas do seu computador com arquivos de música (MP3, FLAC, M4A, OGG, OPUS, WAV). Elas aparecem em Biblioteca → Arquivos locais. <b>{count}</b> músicas carregadas.</p>
        <div className="folders">
          {folders.map(f => (
            <div key={f} className="folder"><span><Folder size={16} /> {f}</span><button className="icon" disabled={busy} onClick={() => saveFolders(folders.filter(x => x !== f))} title="Remover"><Trash2 size={16} /></button></div>
          ))}
          {!folders.length && <p className="muted small">Nenhuma pasta adicionada.</p>}
        </div>
        <div className="row">
          <button className="btn" disabled={busy} onClick={pick}><FolderPlus size={16} /> Escolher pasta…</button>
          <form className="row grow" onSubmit={e => { e.preventDefault(); if (newFolder.trim()) { saveFolders([...folders, newFolder.trim()]); setNewFolder(''); } }}>
            <input value={newFolder} onChange={e => setNewFolder(e.target.value)} placeholder="ou cole o caminho, ex.: C:\Users\Você\Music" />
            <button className="ghost" disabled={busy}>Adicionar</button>
          </form>
          <button className="ghost" disabled={busy || !folders.length} onClick={rescan}><RefreshCw size={15} /> Reescanear</button>
        </div>
        {msg && <p className="muted small">{msg}</p>}
      </section>}
      <UpdatesPanel showToast={showToast} />
      {!isNative && <MediaKeysPanel showToast={showToast} />}
      {!isNative && <DiscordPanel discord={discord} setDiscord={setDiscord} showToast={showToast} />}
    </div>
  );
}

function ListPage({ listId, preview, current, playing, onPlay, inLib, toggleLib, onSave, savedId, onSaved, onBack, onDownload }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    loadPlaylist(listId).then(setData).catch(e => setError(e.message || 'Não foi possível abrir a playlist.'));
  }, [listId]);
  const info = data || preview || {};
  const tracks = data?.tracks || [];
  const total = tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const totalTxt = total >= 3600 ? `${Math.floor(total / 3600)} h ${Math.floor((total % 3600) / 60)} min` : `${Math.floor(total / 60)} min`;
  const isCurrentList = tracks.some(t => t.id === current?.id);

  return (
    <div className="listpage">
      <div className="banner" style={{ '--bg-img': info.thumbnail ? `url(${info.thumbnail})` : 'none' }}>
        <button className="back" onClick={onBack} title="Voltar"><ChevronLeft size={22} /></button>
        <img className="banner-cover" src={info.thumbnail} alt="" />
        <div className="banner-info">
          <span className="kind">{info.kind === 'album' ? 'Álbum' : 'Playlist'}</span>
          <h1 className={(info.title || '').length > 40 ? 'long' : ''}>{info.title || 'Carregando…'}</h1>
          {data?.description && <p className="desc">{data.description}</p>}
          <p className="sub">
            {info.author && <b>{info.author}</b>}
            {data && <> • {tracks.length} músicas{total ? `, ${totalTxt}` : ''}</>}
            {data?.views && <span className="muted"> • {data.views.replace('views', 'visualizações')}</span>}
          </p>
        </div>
      </div>
      <div className="list-actions">
        <button className="bigplay" disabled={!tracks.length} onClick={() => onPlay(tracks, 0)}>{isCurrentList && playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="nudge" />}</button>
        <button className="icon shuffle-btn" disabled={!tracks.length} title="Tocar aleatório" onClick={() => onPlay([...tracks].sort(() => Math.random() - 0.5), 0)}><Shuffle size={24} /></button>
        <button className={`ghost ${savedId ? 'saved' : ''}`} disabled={!tracks.length || !!savedId}
          onClick={() => onSaved(onSave(info.title, tracks))}>{savedId ? <><Check size={16} /><span className="lbl-long">Salva nas suas playlists</span><span className="lbl-short">Salva</span></> : <><ListPlus size={16} /><span className="lbl-long">Salvar nas minhas playlists</span><span className="lbl-short">Salvar</span></>}</button>
        {onDownload && <button className="icon" disabled={!tracks.length} onClick={() => onDownload(tracks)} title="Baixar para ouvir offline"><Download size={22} /></button>}
      </div>
      {error && <p className="muted">{error}</p>}
      {!data && !error && <><MusicLoader text="Carregando músicas da playlist…" /><SkeletonRows /></>}
      <div className="tracks">
        {tracks.map((t, i) => (
          <div key={t.id + i} className={`track ${current?.id === t.id ? 'playing' : ''}`}>
            <span className="num">{current?.id === t.id && playing ? <AudioLines size={16} className="eq" /> : i + 1}</span>
            <Cover src={t.thumbnail} onClick={() => onPlay(tracks, i)} />
            <div className="meta" onClick={() => onPlay(tracks, i)}><div className="t">{t.title}</div><div className="a">{t.author}</div></div>
            <button className={`icon ${inLib(t.id) ? 'liked' : ''}`} onClick={() => toggleLib(t)} title={inLib(t.id) ? 'Remover da biblioteca' : 'Salvar na biblioteca'}><Heart size={17} fill={inLib(t.id) ? 'currentColor' : 'none'} /></button>
            <span />
            <span className="dur">{t.duration ? fmt(t.duration) : ''}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Barra de título do app de desktop (substitui a do Windows). Só aparece no Electron.
function TitleBar({ track, playing }) {
  const w = typeof window !== 'undefined' ? window.sonoraWindow : null;
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!w) return;
    w.isMaximized().then(setMax);
    return w.onMaximizeChange(setMax);
  }, []);
  if (!w) return null;
  return (
    <header className={`titlebar ${max ? 'max' : ''}`}>
      <div className="tb-buttons">
        {/* sem repassar o evento: a ponte segura do Electron não consegue copiar eventos do React */}
        <button onClick={() => w.minimize()} title="Minimizar" aria-label="Minimizar"><Minus size={16} /></button>
        <button onClick={() => w.toggleMaximize()} title={max ? 'Restaurar' : 'Maximizar'} aria-label={max ? 'Restaurar' : 'Maximizar'}>
          {max ? <RestoreIcon size={13} /> : <Square size={13} />}
        </button>
        <button className="tb-close" onClick={() => w.close()} title="Fechar (continua tocando na bandeja)" aria-label="Fechar"><X size={17} /></button>
      </div>
    </header>
  );
}

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite'; };

function Karaoke({ track, lyrics, time, onSeek, onClose }) {
  const lines = lyrics?.synced;
  const offset = 0.3; // compensação leve de atraso
  let active = -1;
  if (lines) for (let i = 0; i < lines.length; i++) { if (lines[i].t <= time + offset) active = i; else break; }
  const activeRef = useRef(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [active]);
  const cur = lines?.[active], nxt = lines?.[active + 1];
  const progress = cur && nxt ? Math.min(1, Math.max(0, (time + offset - cur.t) / (nxt.t - cur.t))) : 0;

  return (
    <div className="karaoke" style={{ '--bg-img': `url(${track.thumbnail})` }}>
      <div className="k-head">
        <div><div className="t">{track.title}</div><div className="a">{lyrics?.found ? `${lyrics.artist} — ${lyrics.track}` : track.author}</div></div>
        <button className="ghost" onClick={onClose}><X size={16} /> Fechar</button>
      </div>
      <div className="k-body">
        {lyrics?.loading && <MusicLoader text="Procurando letra…" />}
        {lyrics && !lyrics.loading && !lyrics.found && <p className="k-msg">Letra não encontrada para esta música</p>}
        {lines && lines.map((l, i) => (
          <p key={i} ref={i === active ? activeRef : null}
             className={`k-line ${i === active ? 'on' : i < active ? 'past' : ''}`}
             style={i === active ? { '--p': `${progress * 100}%` } : undefined}
             onClick={() => onSeek(l.t)}>{l.text || '♪'}</p>
        ))}
        {!lines && lyrics?.plain && <pre className="k-plain">{lyrics.plain}</pre>}
      </div>
      {lyrics?.found && <div className="k-foot">Letras: LRCLIB{lines ? ' · clique numa linha para pular' : ' · sem sincronia disponível'}</div>}
    </div>
  );
}

export default function App() {
  const [library, setLibrary] = useState(() => store.get('sonora.library', []));
  const [playlists, setPlaylists] = useState(() => store.get('sonora.playlists', []));
  const [view, setView] = useState({ type: 'home' });
  const [home, setHome] = useState(null);
  const [karaoke, setKaraoke] = useState(false);
  const [lyrics, setLyrics] = useState(null);
  const [genres, setGenres] = useState(() => store.get('sonora.genres', DEFAULT_GENRES));
  const [localTracks, setLocalTracks] = useState([]);
  const [libTab, setLibTab] = useState('all');
  useEffect(() => store.set('sonora.genres', genres), [genres]);
  const loadLocal = () => { if (isNative) return; fetch('/api/local/tracks').then(r => r.json()).then(setLocalTracks).catch(() => {}); };
  useEffect(() => { loadLocal(); }, []);
  const [query, setQuery] = useState('');
  const [lastQuery, setLastQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [queue, setQueue] = useState([]);
  const [queueSource, setQueueSource] = useState(() => store.get('sonora.queueSource', null));
  useEffect(() => store.set('sonora.queueSource', queueSource), [queueSource]);
  const [index, setIndex] = useState(-1);
  const [playToken, setPlayToken] = useState(0);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [volume, setVol] = useState(() => store.get('sonora.volume', 80));
  const [discord, setDiscord] = useState(null);
  const [appearance, setAppearance] = useState(() => ({ ...DEFAULT_APPEARANCE, effects: !(navigator.deviceMemory && navigator.deviceMemory <= 4), ...store.get('sonora.appearance', {}) }));
  useEffect(() => { applyAppearance(appearance); store.set('sonora.appearance', appearance); }, [appearance]);
  const [toasts, setToasts] = useState([]);
  // action (opcional): { label, run } — vira um botão no alerta
  const showToast = (text, kind = 'error', ms = 6000, action = null) => {
    const id = Math.random();
    setToasts(ts => [...ts.filter(t => t.text !== text), { id, text, kind, action }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), ms);
  };
  const [menu, setMenu] = useState(null);
  const [fullPlayer, setFullPlayer] = useState(false);
  const [collapsed, setCollapsed] = useState(() => store.get('sonora.sidebarCollapsed', false));
  useEffect(() => store.set('sonora.sidebarCollapsed', collapsed), [collapsed]);

  const current = queue[index];

  useEffect(() => store.set('sonora.library', library), [library]);
  useEffect(() => store.set('sonora.playlists', playlists), [playlists]);
  useEffect(() => store.set('sonora.volume', volume), [volume]);

  const go = i => { setIndex(i); setPlayToken(t => t + 1); };
  const next = () => {
    if (!queue.length) return;
    if (repeat) { go(index); return; }
    const n = shuffle ? Math.floor(Math.random() * queue.length) : index + 1;
    if (n < queue.length) go(n);
  };
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const player = isNative ? useNativePlayer((id, i) => setIndex(i)) : usePlayer(next);
  const prev = () => (player.time > 3 ? player.seek(0) : go(Math.max(0, index - 1)));
  const nextAction = isNative ? () => player.next() : next;
  const prevAction = isNative ? () => player.prev() : prev;
  useEffect(() => { if (isNative) player.setShuffle(shuffle); }, [shuffle]);
  useEffect(() => { if (isNative) player.setRepeat(repeat); }, [repeat]);
  useEffect(() => { if (isNative && player.error) showToast('Não foi possível tocar esta música. Pulando…'); }, [player.error]);

  useEffect(() => { if (!isNative && current && (player.ready || current.source === 'local')) player.load(current); }, [playToken, player.ready]);

  // ---------- Atualizações automáticas ----------
  useEffect(() => {
    // Desktop: o Electron baixa sozinho; avisamos quando estiver pronto
    if (isDesktop) {
      return window.sonoraUpdates.onStatus(s => {
        if (s.state === 'ready') showToast(`Sonora ${s.version} baixado. Ele será instalado quando você sair do app.`, 'ok', 15000,
          { label: 'Reiniciar agora', run: () => window.sonoraUpdates.install() });
      });
    }
    if (!isNative) return;
    // Android: confirma que esta interface abriu bem e procura atualizações (ao abrir e a cada 6 h)
    confirmBundleWorks();
    let readyToActivate = false;
    const onHidden = () => { if (document.visibilityState === 'hidden' && readyToActivate) { readyToActivate = false; activateWebUpdate().catch(() => {}); } };
    document.addEventListener('visibilitychange', onHidden);
    const run = async () => {
      try {
        const u = await checkMobileUpdate();
        if (u.type === 'apk') {
          showToast(`Nova versão do Sonora (${u.version}) disponível.`, 'ok', 20000, {
            label: 'Atualizar', run: () => installApkUpdate(u)
              .then(r => r.status === 'needs-permission' && showToast('Permita "instalar apps desta fonte" para o Sonora e toque em Atualizar de novo.', 'error', 12000))
              .catch(e => showToast(e.message || 'Falha ao baixar a atualização.')),
          });
        } else if (u.type === 'web') {
          await downloadWebUpdate(u);
          readyToActivate = true;
          showToast(`Atualização ${u.version} baixada. Ela será aplicada quando você sair do app.`, 'ok', 12000,
            { label: 'Aplicar agora', run: () => activateWebUpdate().catch(() => {}) });
        }
      } catch { /* sem internet: tenta de novo mais tarde */ }
    };
    const first = setTimeout(run, 10000);
    const every = setInterval(run, 6 * 60 * 60 * 1000);
    return () => { clearTimeout(first); clearInterval(every); document.removeEventListener('visibilitychange', onHidden); };
  }, []);

  // PC: teclas multimídia do teclado chegam do servidor (funciona com o navegador minimizado)
  const keyActions = useRef({});
  keyActions.current = {
    playpause: () => current && player.toggle(),
    next: () => next(),
    prev: () => prev(),
    stop: () => player.playing && player.toggle(),
  };
  useEffect(() => {
    if (isNative || typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events');
    es.addEventListener('mediakey', e => {
      try { keyActions.current[JSON.parse(e.data).action]?.(); } catch {}
    });
    return () => es.close();
  }, []);

  // APK: se o app foi reaberto com música tocando, recupera a fila do tocador nativo
  const restored = useRef(false);
  useEffect(() => {
    if (!isNative || restored.current || !player.ready || queue.length || !player.count) return;
    restored.current = true;
    player.getQueue().then(q => {
      if (!q.items?.length) return;
      const saved = store.get('sonora.lastQueue', []);
      const byId = Object.fromEntries(saved.map(t => [t.id, t]));
      setQueue(q.items.map(t => byId[t.id] || t)); // mantém duração/capa salvas quando houver
      setIndex(q.index);
    }).catch(() => {});
  }, [player.ready, player.count]);
  useEffect(() => { if (queue.length) store.set('sonora.lastQueue', queue.slice(0, 400)); }, [queue]);

  // Downloads (APK): ouvir sem internet
  const [downloads, setDownloads] = useState([]);
  const [dlProgress, setDlProgress] = useState({});
  const loadDownloads = () => isNative && Sonora.listDownloads().then(r => setDownloads(r.tracks || [])).catch(() => {});
  useEffect(() => {
    if (!isNative) return;
    loadDownloads();
    const sub = Sonora.addListener('download', ev => {
      setDlProgress(p => ({ ...p, [ev.id]: ev.status === 'downloading' ? ev.progress : ev.status }));
      if (ev.status === 'done') loadDownloads();
      if (ev.status === 'error') showToast(`Falha ao baixar: ${ev.error || 'erro desconhecido'}`);
    });
    return () => { sub.then(h => h.remove()); };
  }, []);
  const isDownloaded = id => downloads.some(d => d.id === id);
  const downloadTracks = list => {
    const todo = list.filter(t => !isDownloaded(t.id) && t.source !== 'local');
    if (!todo.length) { showToast('Já está tudo baixado.', 'ok', 2500); return; }
    setDlProgress(p => ({ ...p, ...Object.fromEntries(todo.map(t => [t.id, 0])) }));
    Sonora.download({ items: todo.map(({ id, title, author, thumbnail, duration }) => ({ id, title, author, thumbnail, duration })) });
    showToast(todo.length === 1 ? 'Baixando para ouvir offline…' : `Baixando ${todo.length} músicas para ouvir offline…`, 'ok', 3000);
  };
  const removeDownload = id => Sonora.removeDownload({ id }).then(loadDownloads);
  useEffect(() => { player.setVolume(volume); }, [volume, player.ready]);

  // Presença no Discord
  const lastSent = useRef('');
  const bucket = Math.round(player.time / 15);
  useEffect(() => {
    if (isNative) return;
    const body = current
      ? { id: current.id, title: current.title, author: current.author, thumbnail: current.thumbnail,
          duration: player.duration || current.duration, position: player.time, paused: !player.playing }
      : { title: null };
    const key = `${body.id}|${body.paused}|${body.paused ? 0 : bucket}`;
    if (key === lastSent.current) return;
    lastSent.current = key;
    fetch('/api/presence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }, [current?.id, player.playing, bucket]);

  useEffect(() => {
    if (isNative) return;
    const check = () => fetch('/api/presence/status').then(r => r.json()).then(setDiscord).catch(() => {});
    check(); const t = setInterval(check, 10000); return () => clearInterval(t);
  }, []);

  // Alerta temporário quando o Discord falha (na primeira checagem ou quando cai)
  const prevDiscord = useRef(null);
  useEffect(() => {
    if (!discord) return;
    const prev = prevDiscord.current;
    prevDiscord.current = discord;
    const failing = discord.enabled && !discord.connected && discord.error;
    const wasFailing = prev && prev.enabled && !prev.connected && prev.error;
    if (failing && (!prev || prev.connected || !wasFailing || prev.error !== discord.error)) {
      showToast(`Discord: ${discord.error}. O status "Ouvindo" não será exibido.`);
    }
    if (prev && !prev.connected && discord.connected && prev.error) showToast('Discord conectado novamente.', 'ok', 3500);
  }, [discord]);

  // Home: recomendações baseadas nos artistas da biblioteca
  const loadHome = () => {
    const artists = [...new Set(library.map(t => t.author.replace(/\s*-\s*Topic$|VEVO$/i, '').trim()).filter(Boolean))].slice(0, 3);
    setHome(null);
    apiHome(artists, genres).then(setHome).catch(() => setHome([]));
  };
  useEffect(() => { if (view.type === 'home' && !home) loadHome(); }, [view.type]);

  // Letras da música atual
  useEffect(() => {
    setLyrics(null);
    if (!current) return;
    let alive = true;
    setLyrics({ loading: true });
    loadLyrics(current).then(d => alive && setLyrics(d)).catch(() => alive && setLyrics({ found: false }));
    return () => { alive = false; };
  }, [current?.id]);

  // Controles na tela de bloqueio / notificação (Media Session)
  useEffect(() => {
    if (isNative || !('mediaSession' in navigator) || !current) return;
    const art = current.thumbnail ? [{ src: new URL(current.thumbnail, location.href).href, sizes: '480x360', type: 'image/jpeg' }] : [];
    navigator.mediaSession.metadata = new MediaMetadata({ title: current.title, artist: current.author, album: 'Sonora', artwork: art });
  }, [current?.id]);
  useEffect(() => {
    if (isNative || !('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    ms.playbackState = player.playing ? 'playing' : 'paused';
    const h = { play: () => !player.playing && player.toggle(), pause: () => player.playing && player.toggle(), nexttrack: next, previoustrack: prev, seekto: d => player.seek(d.seekTime) };
    for (const [k, fn] of Object.entries(h)) { try { ms.setActionHandler(k, fn); } catch {} }
  });

  const search = async e => {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true); setView({ type: 'search' }); setLastQuery(query);
    try { setResults(await searchTracks(query)); }
    catch (err) { setResults([]); showToast(isNative ? 'Sem conexão ou o YouTube não respondeu. Tente de novo.' : 'Falha na busca.'); }
    finally { setLoading(false); }
  };

  const playList = (list, i, label) => {
    const v = view.type === 'settings' ? { type: 'home' } : view;
    const auto = v.type === 'ytlist' ? (v.preview?.title || 'Playlist') : v.type === 'search' ? `Busca: "${lastQuery}"` : v.type === 'home' ? 'Início' : title;
    setQueueSource({ label: label || auto, view: v });
    setQueue(list);
    if (isNative) { setIndex(i); player.setQueue(list, i); } else go(i);
  };
  const inLib = id => library.some(t => t.id === id);
  const toggleLib = t => setLibrary(l => (l.some(x => x.id === t.id) ? l.filter(x => x.id !== t.id) : [t, ...l]));
  const addToPlaylist = (pid, t) => setPlaylists(ps => ps.map(p => p.id === pid && !p.tracks.some(x => x.id === t.id) ? { ...p, tracks: [...p.tracks, t] } : p));
  const removeFromPlaylist = (pid, tid) => setPlaylists(ps => ps.map(p => p.id === pid ? { ...p, tracks: p.tracks.filter(x => x.id !== tid) } : p));
  const newPlaylist = () => {
    const name = prompt('Nome da playlist:'); if (!name) return;
    const p = { id: crypto.randomUUID(), name, tracks: [] };
    setPlaylists(ps => [...ps, p]); setView({ type: 'playlist', id: p.id });
  };
  const deletePlaylist = id => { if (confirm('Excluir playlist?')) { setPlaylists(ps => ps.filter(p => p.id !== id)); setView({ type: 'library' }); } };

  const { title, tracks, playlist } = useMemo(() => {
    if (view.type === 'library') {
      const liked = library.filter(t => !localTracks.some(l => l.id === t.id));
      const all = libTab === 'liked' ? library : libTab === 'local' ? localTracks : libTab === 'downloads' ? downloads : [...liked, ...localTracks];
      return { title: 'Sua biblioteca', tracks: all };
    }
    if (view.type === 'playlist') { const p = playlists.find(p => p.id === view.id); return { title: p?.name, tracks: p?.tracks || [], playlist: p }; }
    return { title: lastQuery ? `Resultados para "${lastQuery}"` : 'Buscar', tracks: results };
  }, [view, library, playlists, results, lastQuery, localTracks, libTab, downloads]);

  return (
    <div className={`app ${collapsed ? 'collapsed' : ''}`} onClick={() => setMenu(null)}>
      <TitleBar track={current} playing={player.playing} />
      <aside className="sidebar">
        <div className="logo"><span className="logo-mark"><Disc3 size={20} strokeWidth={2.4} /></span><span className="logo-text">Sonora</span>
          <button className="icon collapse-btn" onClick={() => setCollapsed(c => !c)} title={collapsed ? 'Expandir painel' : 'Compactar painel'} aria-label={collapsed ? 'Expandir painel' : 'Compactar painel'} aria-expanded={!collapsed}>
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <button className={view.type === 'home' ? 'nav active' : 'nav'} title="Início" onClick={() => setView({ type: 'home' })}><House size={20} /> <span>Início</span></button>
        <button className={view.type === 'search' ? 'nav active' : 'nav'} title="Buscar" onClick={() => setView({ type: 'search' })}><Search size={20} /> <span>Buscar</span></button>
        <button className={view.type === 'library' ? 'nav active' : 'nav'} title="Biblioteca" onClick={() => setView({ type: 'library' })}><Library size={20} /> <span>Biblioteca</span> <span className="count">{library.length}</span></button>
        <div className="section"><span className="section-text">Playlists</span> <button className="icon" onClick={newPlaylist} title="Nova playlist"><Plus size={18} /></button></div>
        <div className="playlists">
          {playlists.map(p => (
            <button key={p.id} className={view.id === p.id ? 'nav active' : 'nav'} title={p.name} onClick={() => setView({ type: 'playlist', id: p.id })}><PlaylistCover tracks={p.tracks} /> <span className="nav-label">{p.name}</span> <span className="count">{p.tracks.length}</span></button>
          ))}
          {!playlists.length && <p className="muted small">Nenhuma playlist ainda.</p>}
        </div>
        <button className={view.type === 'settings' ? 'nav active' : 'nav'} title="Configurações" onClick={() => setView({ type: 'settings' })}><SettingsIcon size={20} /> <span>Configurações</span></button>
      </aside>

      <main className="main" onScroll={e => e.currentTarget.classList.toggle('scrolled', e.currentTarget.scrollTop > 4)}>
        <form className="searchbar" onSubmit={search}>
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar músicas, artistas…" />
          <button>Buscar</button>
        </form>
        {view.type === 'ytlist' ? (
          <ListPage key={view.listId} listId={view.listId} preview={view.preview} current={current} playing={player.playing}
            onPlay={(tracks, i) => playList(tracks, i)} inLib={inLib} toggleLib={toggleLib}
            onSave={(name, tracks) => { const p = { id: crypto.randomUUID(), name, tracks }; setPlaylists(ps => [...ps, p]); return p.id; }}
            savedId={playlists.find(p => p.sourceList === view.listId)?.id}
            onSaved={(pid) => setPlaylists(ps => ps.map(p => p.id === pid ? { ...p, sourceList: view.listId } : p))}
            onDownload={isNative ? downloadTracks : undefined}
            onBack={() => setView({ type: 'home' })} />
        ) : view.type === 'settings' ? (
          <Settings genres={genres} setGenres={g => { setGenres(g); setHome(null); }} onLocalChange={loadLocal} downloads={downloads} onClearDownloads={async () => { for (const d of downloads) await Sonora.removeDownload({ id: d.id }); loadDownloads(); }}
            appearance={appearance} setAppearance={setAppearance} discord={discord} setDiscord={setDiscord} showToast={showToast} />
        ) : view.type === 'home' ? (
          <div className="home">
            <div className="header"><h1>{greeting()}</h1><button className="ghost" onClick={loadHome}><RefreshCw size={15} /> Atualizar</button></div>
            {!home && <><MusicLoader text="Preparando suas recomendações…" /><SkeletonShelf /><SkeletonShelf /></>}
            {home?.length === 0 && <p className="muted">Não foi possível carregar recomendações.</p>}
            {home?.map(sec => (
              <section key={sec.title} className="shelf">
                <h2>{sec.title}</h2>
                <div className="cards">
                  {(sec.playlists || []).map(p => (
                    <div key={p.listId} className="card list" onClick={() => setView({ type: 'ytlist', listId: p.listId, preview: p })}>
                      <div className="cover"><img src={p.thumbnail} alt="" /><span className="stack"><ListMusic size={12} /> {p.count || ''}</span><span className="fab"><Play size={18} fill="currentColor" className="nudge" /></span></div>
                      <div className="t">{p.title}</div>
                      <div className="a">{p.kind === 'album' ? 'Álbum' : 'Playlist'}{p.author ? ` • ${p.author}` : ''}</div>
                    </div>
                  ))}
                  {sec.tracks.map((t, i) => (
                    <div key={t.id} className={`card ${current?.id === t.id ? 'playing' : ''}`} onClick={() => playList(sec.tracks, i, sec.title)}>
                      <div className="cover"><img src={t.thumbnail} alt="" /><span className="fab">{current?.id === t.id && player.playing ? <AudioLines size={18} /> : <Play size={18} fill="currentColor" className="nudge" />}</span>
                        <button className={`heart ${inLib(t.id) ? 'liked' : ''}`} onClick={e => { e.stopPropagation(); toggleLib(t); }}><Heart size={16} fill={inLib(t.id) ? 'currentColor' : 'none'} /></button>
                      </div>
                      <div className="t">{t.title}</div><div className="a">{t.author}</div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : <>
        <div className="header">
          <h1>{title}</h1>
          {tracks.length > 0 && <button className="play-all" onClick={() => playList(tracks, 0)}><Play size={16} fill="currentColor" /> Tocar</button>}
          {isNative && tracks.length > 0 && libTab !== 'downloads' && <button className="ghost" onClick={() => downloadTracks(tracks)}><Download size={16} /> Baixar</button>}
          {playlist && <button className="ghost" onClick={() => deletePlaylist(playlist.id)}>Excluir</button>}
        </div>
        {view.type === 'library' && (
          <div className="lib-playlists mobile-only">
            <button className="lib-pl new" onClick={newPlaylist}><span className="cover-ph"><Plus size={20} /></span><span>Nova playlist</span></button>
            {playlists.map(p => (
              <button key={p.id} className="lib-pl" onClick={() => setView({ type: 'playlist', id: p.id })}>
                <PlaylistCover tracks={p.tracks} className="lg" /><span><b>{p.name}</b><small>{p.tracks.length} músicas</small></span>
              </button>
            ))}
          </div>
        )}
        {view.type === 'library' && (
          <div className="chips">
            {(isNative
              ? [['all', 'Tudo'], ['liked', `Curtidas (${library.length})`], ['downloads', `Baixadas (${downloads.length})`]]
              : [['all', 'Tudo'], ['liked', `Curtidas (${library.length})`], ['local', `Arquivos locais (${localTracks.length})`]]).map(([k, l]) => (
              <button key={k} className={`chip ${libTab === k ? 'on' : ''}`} onClick={() => setLibTab(k)}>{l}</button>
            ))}
          </div>
        )}
        {loading && <><MusicLoader text="Buscando músicas…" /><SkeletonRows /></>}
        {!loading && !tracks.length && <p className="muted">{view.type === 'search' ? 'Pesquise algo para começar.' : 'Nada aqui ainda — busque músicas e salve com o coração ou adicione a uma playlist.'}</p>}
        <div className="tracks">
          {tracks.map((t, i) => (
            <div key={t.id + i} className={`track ${current?.id === t.id ? 'playing' : ''}`}>
              <span className="num">{current?.id === t.id && player.playing ? <AudioLines size={16} className="eq" /> : i + 1}</span>
              <Cover src={t.thumbnail} onClick={() => playList(tracks, i)} />
              <div className="meta" onClick={() => playList(tracks, i)}><div className="t">{t.title}</div><div className="a">{t.source === 'local' && <span className="badge">LOCAL</span>}<DlBadge id={t.id} done={isDownloaded(t.id)} progress={dlProgress[t.id]} />{t.author}</div></div>
              <button className={`icon ${inLib(t.id) ? 'liked' : ''}`} onClick={() => toggleLib(t)} title={inLib(t.id) ? 'Remover da biblioteca' : 'Salvar na biblioteca'}><Heart size={17} fill={inLib(t.id) ? 'currentColor' : 'none'} /></button>
              <div className="rel">
                <button className="icon" onClick={e => { e.stopPropagation(); setMenu(menu === t.id + i ? null : t.id + i); }} title="Adicionar à playlist"><Ellipsis size={18} /></button>
                {menu === t.id + i && (
                  <div className="menu" onClick={e => e.stopPropagation()}>
                    {playlists.map(p => <button key={p.id} onClick={() => { addToPlaylist(p.id, t); setMenu(null); }}>{p.name}</button>)}
                    {!playlists.length && <span className="muted small">Crie uma playlist</span>}
                    {playlist && <button className="danger" onClick={() => { removeFromPlaylist(playlist.id, t.id); setMenu(null); }}>Remover desta playlist</button>}
                    {isNative && (isDownloaded(t.id)
                      ? <button className="danger" onClick={() => { removeDownload(t.id); setMenu(null); }}>Apagar download</button>
                      : <button onClick={() => { downloadTracks([t]); setMenu(null); }}>Baixar para ouvir offline</button>)}
                  </div>
                )}
              </div>
              <span className="dur">{fmt(t.duration)}</span>
            </div>
          ))}
        </div>
        </>}
      </main>

      {karaoke && current && <Karaoke track={current} lyrics={lyrics} time={player.time} onSeek={player.seek} onClose={() => setKaraoke(false)} />}

      <footer className={`bar ${current ? "" : "empty"}`}>
        <div className="mini-progress" style={{ width: `${player.duration ? (player.time / player.duration) * 100 : 0}%` }} />
        <div className="now" onClick={() => current && window.matchMedia('(max-width: 700px), (max-height: 500px) and (pointer: coarse)').matches && setFullPlayer(true)}>
          {current && <><Cover src={current.thumbnail} big /><div><div className="t">{current.title}</div><div className="a">{current.author}</div></div></>}
        </div>
        <div className="controls">
          <div className="buttons">
            <button className={`icon ${shuffle ? 'liked' : ''}`} onClick={() => setShuffle(s => !s)} title="Aleatório"><Shuffle size={18} /></button>
            <button className="icon" onClick={prevAction} title="Anterior"><SkipBack size={20} fill="currentColor" /></button>
            <button className="big" onClick={player.toggle} disabled={!current} title={player.playing ? 'Pausar' : 'Tocar'}>{player.playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="nudge" />}</button>
            <button className="icon" onClick={nextAction} title="Próxima"><SkipForward size={20} fill="currentColor" /></button>
            <button className={`icon ${repeat ? 'liked' : ''}`} onClick={() => setRepeat(r => !r)} title="Repetir"><Repeat size={18} /></button>
          </div>
          <div className="progress">
            <span>{fmt(player.time)}</span>
            <input type="range" min="0" max={player.duration || 1} step="1" value={player.time} onChange={e => player.seek(+e.target.value)} />
            <span>{fmt(player.duration)}</span>
          </div>
        </div>
        <div className="mini-actions mobile-only">
          <button className="icon" disabled={!current} onClick={player.toggle} title={player.playing ? 'Pausar' : 'Tocar'}>{player.playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}</button>
          <button className="icon" disabled={!current} onClick={nextAction} title="Próxima"><SkipForward size={22} fill="currentColor" /></button>
        </div>
        <div className="volume">
          <button className={`icon mic ${karaoke ? 'liked' : ''} ${lyrics?.found ? 'has' : ''}`} disabled={!current}
            title={lyrics?.found ? (lyrics.synced ? 'Modo karaokê' : 'Letra (sem sincronia)') : 'Letra não encontrada'}
            onClick={() => setKaraoke(k => !k)}><MicVocal size={18} /></button>
          <button className="icon" title={volume ? 'Silenciar' : 'Ativar som'} onClick={() => setVol(v => (v ? 0 : 70))}>{volume === 0 ? <VolumeX size={18} /> : volume < 50 ? <Volume1 size={18} /> : <Volume2 size={18} />}</button><input type="range" min="0" max="100" value={volume} onChange={e => setVol(+e.target.value)} /></div>
      </footer>

      <nav className="tabbar" aria-label="Navegação">
        {[['home', House, 'Início'], ['search', Search, 'Buscar'], ['library', Library, 'Biblioteca'], ['settings', SettingsIcon, 'Ajustes']].map(([k, I, l]) => (
          <button key={k} className={view.type === k || (k === 'library' && view.type === 'playlist') ? 'on' : ''} onClick={() => { setView({ type: k }); document.querySelector('.main')?.scrollTo(0, 0); }}>
            <I size={22} /><span>{l}</span>
          </button>
        ))}
      </nav>

      {fullPlayer && current && (
        <FullPlayer track={current} player={player} onClose={() => setFullPlayer(false)} next={nextAction} prev={prevAction}
          source={queueSource} onGoSource={() => { setFullPlayer(false); if (queueSource?.view) setView(queueSource.view); }}
          shuffle={shuffle} setShuffle={setShuffle} repeat={repeat} setRepeat={setRepeat}
          liked={inLib(current.id)} onLike={() => toggleLib(current)} lyrics={lyrics}
          onKaraoke={() => { setFullPlayer(false); setKaraoke(true); }} />
      )}
      <div className="hidden-player"><div id="yt-player" /></div>
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-ico">{t.kind === 'ok' ? <CircleCheck size={20} /> : <CircleAlert size={20} />}</span>
            <span>{t.text}</span>
            {t.action && <button className="toast-action" onClick={() => { setToasts(ts => ts.filter(x => x.id !== t.id)); t.action.run(); }}>{t.action.label}</button>}
            <button className="icon" onClick={() => setToasts(ts => ts.filter(x => x.id !== t.id))} title="Fechar"><X size={16} /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
