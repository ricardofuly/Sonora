// Camada de dados: no APK fala direto com o YouTube (código nativo) e com o LRCLIB;
// no navegador usa o servidor do PC.
import { isNative, Sonora } from './native.js';

const DEFAULT_SEEDS = ['top hits brasil', 'sertanejo mais tocadas', 'funk mais tocadas', 'pop internacional hits', 'rock clássico', 'lofi beats'];

export async function searchTracks(q) {
  if (!isNative) return (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
  const r = await Sonora.search({ query: q, limit: 25 });
  return r.tracks || [];
}

export async function loadHome(artists, genres) {
  if (!isNative) {
    return (await fetch(`/api/home?artists=${encodeURIComponent(artists.join('|'))}&genres=${encodeURIComponent(genres.join('|'))}`)).json();
  }
  const genreSections = genres
    ? genres.slice(0, 10).map(g => ({ title: g, q: `${g} mais tocadas`, pq: `${g} playlist` }))
    : DEFAULT_SEEDS.map(q => ({ title: q[0].toUpperCase() + q.slice(1), q, pq: `${q} playlist` }));
  const sections = [
    ...artists.slice(0, 3).map(a => ({ title: `Porque você curtiu ${a}`, q: `${a} mix`, pq: `${a} álbum` })),
    ...genreSections,
  ];
  // de 3 em 3 para não sobrecarregar a conexão móvel
  const out = [];
  for (let i = 0; i < sections.length; i += 3) {
    const batch = await Promise.all(sections.slice(i, i + 3).map(async s => {
      try {
        const r = await Sonora.search({ query: s.q, limit: 12, playlists: true, playlistQuery: s.pq });
        const tracks = (r.tracks || []).filter(t => t.duration > 60 && t.duration < 1500);
        return { title: s.title, tracks: tracks.length >= 6 ? tracks : (r.tracks || []), playlists: r.playlists || [] };
      } catch { return null; }
    }));
    out.push(...batch);
  }
  return out.filter(s => s?.tracks.length);
}

export async function loadPlaylist(id) {
  if (!isNative) {
    const r = await fetch(`/api/playlist/${encodeURIComponent(id)}`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  }
  return Sonora.playlist({ id });
}

// ---------- Letras (LRCLIB) ----------
function cleanTitle(title, author) {
  let t = title.replace(/\[[^\]]*\]|\([^)]*\)|【[^】]*】/g, ' ')
    .replace(/\b(official|oficial|video|vídeo|clipe|clip|lyrics?|letra|audio|áudio|hd|4k|mv|visualizer|ao vivo|live)\b/gi, ' ')
    .replace(/[|•].*$/, ' ').replace(/\s+/g, ' ').trim();
  let artist = (author || '').replace(/\s*-\s*Topic$|VEVO$|Oficial$|Official$/i, '').trim();
  const m = t.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (m) { artist = m[1].trim(); t = m[2].trim(); }
  return { track: t.replace(/\s*(ft|feat)\.?\s.*$/i, '').trim(), artist };
}

export async function loadLyrics(track) {
  if (!isNative) {
    const r = await fetch(`/api/lyrics?title=${encodeURIComponent(track.title)}&author=${encodeURIComponent(track.author)}&duration=${track.duration || 0}`);
    return r.json();
  }
  const { track: name, artist } = cleanTitle(track.title, track.author);
  const get = async url => { const r = await fetch(url); return r.ok ? r.json() : []; };
  let list = await get(`https://lrclib.net/api/search?track_name=${encodeURIComponent(name)}&artist_name=${encodeURIComponent(artist)}`);
  if (!list.length) list = await get(`https://lrclib.net/api/search?q=${encodeURIComponent(`${artist} ${name}`)}`);
  const score = x => (x.syncedLyrics ? 0 : 1000) + (track.duration ? Math.abs((x.duration || 0) - track.duration) : 0);
  list = list.filter(x => x.syncedLyrics || x.plainLyrics).sort((a, b) => score(a) - score(b));
  const best = list[0];
  if (!best) return { found: false };
  const synced = best.syncedLyrics
    ? best.syncedLyrics.split('\n').map(l => {
        const mm = l.match(/^\[(\d+):(\d+(?:\.\d+)?)\]\s*(.*)$/);
        return mm ? { t: +mm[1] * 60 + +mm[2], text: mm[3] } : null;
      }).filter(Boolean)
    : null;
  return { found: true, track: best.trackName, artist: best.artistName, synced, plain: best.plainLyrics || null };
}
