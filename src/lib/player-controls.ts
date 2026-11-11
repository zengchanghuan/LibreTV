import type Artplayer from 'artplayer';

/** Network activity must not reveal controls over an otherwise idle picture. */
export function bindPlaybackControls(art: Artplayer): () => void {
  const reveal = () => { art.controls.show = true; };
  const keepInteractive = (visible: boolean) => {
    // Pause/seek are explicit playback interactions. A low readyState, waiting,
    // or stalled notification alone is not: HLS can emit them between loads.
    if (!visible && (art.video.paused || art.video.seeking)) reveal();
  };
  art.on('control', keepInteractive);
  art.on('video:seeking', reveal);
  return () => {
    art.off('control', keepInteractive);
    art.off('video:seeking', reveal);
  };
}
