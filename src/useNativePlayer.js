import { useEffect, useRef, useState, useCallback } from 'react';
import { Sonora } from './native.js';

// Tocador do APK: a fila e a reprodução ficam no serviço nativo (Media3).
// Assim funciona com tela apagada e responde a fones, Galaxy Fit/Watch e tela de bloqueio.
export function useNativePlayer(onTrackChange) {
  const [s, setS] = useState({ ready: false, playing: false, position: 0, duration: 0, index: -1, mediaId: null });
  const cb = useRef(onTrackChange);
  cb.current = onTrackChange;
  const lastId = useRef(null);

  useEffect(() => {
    const apply = st => {
      setS(prev => ({ ...prev, ...st }));
      if (st.mediaId && st.mediaId !== lastId.current) { lastId.current = st.mediaId; cb.current?.(st.mediaId, st.index); }
    };
    const sub = Sonora.addListener('state', apply);
    // posição: atualiza enquanto a tela está visível (com tela apagada não precisa)
    const t = setInterval(() => { if (document.visibilityState === 'visible') Sonora.getState().then(apply).catch(() => {}); }, 500);
    Sonora.getState().then(apply).catch(() => {});
    return () => { clearInterval(t); sub.then(h => h.remove()); };
  }, []);

  const setQueue = useCallback((items, index) => {
    lastId.current = items[index]?.id;
    const clean = items.map(({ id, title, author, thumbnail, duration }) => ({ id, title, author, thumbnail, duration }));
    return Sonora.setQueue({ items: clean, index, position: 0 });
  }, []);

  return {
    ready: s.ready,
    count: s.count || 0,
    getQueue: () => Sonora.getQueue(),
    playing: s.playing || (s.playWhenReady && s.buffering),
    buffering: s.buffering,
    time: s.position || 0,
    duration: s.duration || 0,
    index: s.index,
    error: s.error,
    load: () => {}, // no APK a fila é enviada inteira via setQueue
    setQueue,
    toggle: () => (s.playWhenReady ? Sonora.pause() : Sonora.play()),
    seek: pos => { setS(p => ({ ...p, position: pos })); Sonora.seek({ position: pos }); },
    next: () => Sonora.next(),
    prev: () => Sonora.previous(),
    skipTo: i => Sonora.skipTo({ index: i }),
    setShuffle: v => Sonora.setShuffle({ enabled: v }),
    setRepeat: v => Sonora.setRepeat({ enabled: v }),
    setVolume: v => Sonora.setVolume({ volume: v / 100 }),
  };
}
