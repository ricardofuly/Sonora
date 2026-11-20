import { useEffect, useRef, useState, useCallback } from 'react';
import workletUrl from './normalizer-worklet.js?url';

let apiPromise;
function loadYT() {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!apiPromise) apiPromise = new Promise(resolve => {
    window.onYouTubeIframeAPIReady = () => resolve(window.YT);
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(s);
  });
  return apiPromise;
}

// Normalização no PC:
// - YouTube: o iframe não dá acesso ao áudio, mas o YouTube informa a sonoridade de cada vídeo
//   (loudnessDb, relativo a ≈ -14 LUFS) e o próprio player já abaixa os vídeos altos. Para aproximar
//   os baixos, abaixamos todo o resto em HEADROOM_DB e devolvemos esse espaço aos vídeos baixos.
// - Arquivos locais: passam por um AudioWorklet que mede e ajusta o volume em tempo real,
//   com alvo no mesmo nível dos vídeos.
const HEADROOM_DB = 5;
const LOCAL_TARGET_LUFS = -14 - HEADROOM_DB;
const ytGainFor = loudnessDb => {
  if (typeof loudnessDb !== 'number') return 10 ** (-HEADROOM_DB / 20);
  return 10 ** (Math.min(0, -HEADROOM_DB - Math.min(0, loudnessDb)) / 20);
};
const loudCache = new Map();
async function fetchLoudness(id) {
  if (loudCache.has(id)) return loudCache.get(id);
  const p = fetch(`/api/loudness/${encodeURIComponent(id)}`).then(r => r.json()).then(d => d.loudnessDb ?? null).catch(() => null);
  loudCache.set(id, p);
  const v = await p;
  if (v === null) loudCache.delete(id); // tenta de novo na próxima vez
  return v;
}

// Player único que toca vídeos do YouTube (iframe) ou arquivos locais (<audio>)
export function usePlayer(onEnded) {
  const yt = useRef(null);
  const audio = useRef(null);
  const mode = useRef('yt'); // 'yt' | 'local'
  const endedRef = useRef(onEnded);
  endedRef.current = onEnded;
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const vol = useRef(80);
  const norm = useRef(true);
  const ytGain = useRef(1);
  const trackId = useRef(null);
  const graph = useRef(null); // { ctx, node } do AudioWorklet (arquivos locais)

  const applyYtVolume = useCallback(() => {
    const g = norm.current ? ytGain.current : 1;
    yt.current?.setVolume?.(Math.round(vol.current * g));
  }, []);

  // Liga o <audio> ao normalizador na primeira música local (precisa de um gesto do usuário)
  const ensureGraph = useCallback(async () => {
    if (graph.current) { if (graph.current.ctx.state === 'suspended') graph.current.ctx.resume().catch(() => {}); return; }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    graph.current = { ctx, node: null };
    try {
      await ctx.audioWorklet.addModule(workletUrl);
      const node = new AudioWorkletNode(ctx, 'sonora-normalizer', { processorOptions: { target: LOCAL_TARGET_LUFS, enabled: norm.current } });
      ctx.createMediaElementSource(audio.current).connect(node).connect(ctx.destination);
      graph.current.node = node;
    } catch (e) {
      console.warn('[sonora] normalização indisponível para arquivos locais', e);
      try { ctx.createMediaElementSource(audio.current).connect(ctx.destination); } catch {}
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  }, []);

  useEffect(() => {
    const a = new Audio();
    a.preload = 'auto';
    a.addEventListener('play', () => mode.current === 'local' && setPlaying(true));
    a.addEventListener('pause', () => mode.current === 'local' && setPlaying(false));
    a.addEventListener('loadedmetadata', () => setDuration(a.duration || 0));
    a.addEventListener('ended', () => endedRef.current?.());
    a.addEventListener('error', () => mode.current === 'local' && a.src && endedRef.current?.());
    audio.current = a;

    loadYT().then(YT => {
      if (yt.current) return;
      yt.current = new YT.Player('yt-player', {
        height: '1', width: '1',
        playerVars: { autoplay: 1, controls: 0, playsinline: 1 },
        events: {
          onReady: () => setReady(true),
          onStateChange: e => {
            if (mode.current !== 'yt') return;
            setPlaying(e.data === YT.PlayerState.PLAYING);
            if (e.data === YT.PlayerState.PLAYING) setDuration(yt.current.getDuration());
            if (e.data === YT.PlayerState.ENDED) endedRef.current?.();
          },
          onError: () => mode.current === 'yt' && endedRef.current?.(),
        },
      });
    });
    const t = setInterval(() => {
      if (mode.current === 'local') setTime(audio.current.currentTime || 0);
      else if (yt.current?.getCurrentTime) setTime(yt.current.getCurrentTime() || 0);
    }, 250);
    return () => { clearInterval(t); a.pause(); };
  }, []);

  const load = useCallback(track => {
    setTime(0); setDuration(track.duration || 0);
    trackId.current = track.id;
    if (track.source === 'local') {
      mode.current = 'local';
      yt.current?.pauseVideo?.();
      ensureGraph().then(() => graph.current?.node?.port.postMessage({ newTrack: true }));
      audio.current.src = `/api/local/stream/${track.id}`;
      audio.current.play().catch(() => {});
    } else {
      mode.current = 'yt';
      audio.current.pause();
      ytGain.current = ytGainFor(null);
      applyYtVolume();
      yt.current?.loadVideoById(track.id);
      if (norm.current) fetchLoudness(track.id).then(db => {
        if (trackId.current !== track.id) return;
        ytGain.current = ytGainFor(db);
        applyYtVolume();
      });
    }
  }, [ensureGraph, applyYtVolume]);
  const toggle = useCallback(() => {
    if (mode.current === 'local') {
      if (graph.current?.ctx.state === 'suspended') graph.current.ctx.resume().catch(() => {});
      audio.current.paused ? audio.current.play() : audio.current.pause();
      return;
    }
    if (!yt.current) return;
    playing ? yt.current.pauseVideo() : yt.current.playVideo();
  }, [playing]);
  const seek = useCallback(s => {
    if (mode.current === 'local') audio.current.currentTime = s;
    else yt.current?.seekTo(s, true);
    setTime(s);
  }, []);
  const setVolume = useCallback(v => {
    vol.current = v;
    if (audio.current) audio.current.volume = v / 100;
    applyYtVolume();
  }, [applyYtVolume]);
  const setNormalize = useCallback(on => {
    norm.current = on;
    graph.current?.node?.port.postMessage({ enabled: on });
    if (on && mode.current === 'yt' && trackId.current) fetchLoudness(trackId.current).then(db => {
      if (mode.current === 'yt') { ytGain.current = ytGainFor(db); applyYtVolume(); }
    });
    applyYtVolume();
  }, [applyYtVolume]);

  return { ready, playing, time, duration, load, toggle, seek, setVolume, setNormalize };
}
