import type Artplayer from 'artplayer';

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => void | Promise<void>;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

/** ArtPlayer 5 waits for loadedmetadata to define fullscreen, even though
 * element fullscreen does not need a playable video. Bridge that startup gap;
 * its normal accessor and listeners take over as soon as metadata arrives. */
export function bindEarlyFullscreen(art: Artplayer): () => void {
  if (Object.getOwnPropertyDescriptor(art, 'fullscreen')?.get) return () => {};
  const player = art.template.$player as FullscreenElement;
  const doc = player.ownerDocument as FullscreenDocument;
  const standard = typeof player.requestFullscreen === 'function';
  const request = standard ? player.requestFullscreen : player.webkitRequestFullscreen;
  const exit = standard ? doc.exitFullscreen : doc.webkitExitFullscreen;
  const enabled = standard ? doc.fullscreenEnabled : doc.webkitFullscreenEnabled;
  const changeEvent = standard ? 'fullscreenchange' : 'webkitfullscreenchange';
  const errorEvent = standard ? 'fullscreenerror' : 'webkitfullscreenerror';
  const isFullscreen = () => (standard ? doc.fullscreenElement : doc.webkitFullscreenElement) === player;
  let disposed = false;
  let pending = false;
  let requested = false;
  let usingFallback = false;
  let active = false;
  const ownsAccessor = () => Object.getOwnPropertyDescriptor(art, 'fullscreen')?.get === isFullscreen;
  const sync = () => {
    if (!ownsAccessor()) return;
    pending = false;
    const next = isFullscreen();
    if (next === active) return;
    active = next;
    if (active) art.state = 'fullscreen';
    player.classList.toggle('art-fullscreen', active);
    art.emit('fullscreen', active);
    art.emit('resize');
  };
  const fallback = () => {
    if (!disposed && !art.isDestroy && !isFullscreen() && !art.fullscreenWeb) {
      usingFallback = true;
      art.fullscreenWeb = true;
    }
  };
  const failed = (enter: boolean) => {
    pending = false;
    if (enter) fallback();
    else if (!disposed) art.notice.show = '暂时无法退出全屏，请按 Esc 重试';
  };
  const onError = () => { if (pending && ownsAccessor()) failed(requested); };
  Object.defineProperty(art, 'fullscreen', {
    configurable: true,
    get: isFullscreen,
    set: (value: boolean) => {
      if (disposed || pending) return;
      if (value === isFullscreen()) return;
      if (value && usingFallback && art.fullscreenWeb) {
        art.fullscreenWeb = false;
        usingFallback = false;
        return;
      }
      if (value && (!request || !exit || enabled === false)) {
        fallback();
        return;
      }
      pending = true;
      requested = value;
      try {
        // Call in the click/key event, before any await loses user activation.
        const result = value ? request!.call(player) : exit!.call(doc);
        // Older WebKit returns void and reports completion only through events.
        if (result) void result.catch(() => failed(value)).finally(() => { pending = false; });
      } catch {
        failed(value);
      }
    },
  });
  doc.addEventListener(changeEvent, sync);
  doc.addEventListener(errorEvent, onError);
  const handoff = () => {
    doc.removeEventListener(changeEvent, sync);
    doc.removeEventListener(errorEvent, onError);
    art.off('video:loadedmetadata', handoff);
  };
  art.on('video:loadedmetadata', handoff);
  return () => {
    disposed = true;
    handoff();
    if (ownsAccessor()) Reflect.deleteProperty(art, 'fullscreen');
  };
}
