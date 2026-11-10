import { useEffect, useRef, useState, useCallback } from 'react';

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
    if (track.source === 'local') {
      mode.current = 'local';
      yt.current?.pauseVideo?.();
      audio.current.src = `/api/local/stream/${track.id}`;
      audio.current.play().catch(() => {});
    } else {
      mode.current = 'yt';
      audio.current.pause();
      yt.current?.loadVideoById(track.id);
    }
  }, []);
  const toggle = useCallback(() => {
    if (mode.current === 'local') { audio.current.paused ? audio.current.play() : audio.current.pause(); return; }
    if (!yt.current) return;
    playing ? yt.current.pauseVideo() : yt.current.playVideo();
  }, [playing]);
  const seek = useCallback(s => {
    if (mode.current === 'local') audio.current.currentTime = s;
    else yt.current?.seekTo(s, true);
    setTime(s);
  }, []);
  const setVolume = useCallback(v => {
    if (audio.current) audio.current.volume = v / 100;
    yt.current?.setVolume?.(v);
  }, []);

  return { ready, playing, time, duration, load, toggle, seek, setVolume };
}
