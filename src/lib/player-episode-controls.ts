import type Artplayer from 'artplayer';

interface EpisodeControlsState {
  count: number;
  index: number;
  onEpisode?: (index: number) => void;
}

/** Insert around ArtPlayer's play control without replacing the player/video. */
export function bindEpisodeControls(art: Artplayer, initial: EpisodeControlsState) {
  let state = initial;
  let disposed = false;
  const root = art.template.$player;
  const controls = ([-1, 1] as const).map(direction => {
    const previous = direction === -1;
    const name = previous ? 'episode-previous' : 'episode-next';
    const label = previous ? '上一集' : '下一集';
    const button = root.ownerDocument.createElement('button');
    button.type = 'button';
    button.className = 'hometv-episode-button';
    button.setAttribute('aria-label', label);
    button.setAttribute('aria-keyshortcuts', previous ? 'Alt+ArrowLeft' : 'Alt+ArrowRight');
    button.title = `${label}（Alt + ${previous ? '←' : '→'}）`;
    button.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><path d="${previous ? 'M5 5h2v14H5zM19 5v14L8 12z' : 'M17 5h2v14h-2zM5 5l11 7-11 7z'}"/></svg>`;
    const click = (event: MouseEvent) => {
      event.stopPropagation();
      const target = state.index + direction;
      if (!disposed && state.count > 1 && !button.disabled && target >= 0 && target < state.count) state.onEpisode?.(target);
    };
    button.addEventListener('click', click);
    // Built-in playAndPause is index 10; volume is index 20.
    art.controls.add({ name, position: 'left', index: previous ? 5 : 15, html: button });
    const wrapper = button.parentElement!;
    return { name, direction, button, wrapper, click };
  });
  const update = (next: EpisodeControlsState) => {
    if (disposed) return;
    state = next;
    const visible = state.count > 1 && !!state.onEpisode;
    root.classList.toggle('hometv-has-episodes', visible);
    for (const { direction, button, wrapper } of controls) {
      wrapper.style.display = visible ? '' : 'none';
      button.disabled = !visible || state.index + direction < 0 || state.index + direction >= state.count;
    }
  };
  update(initial);
  return {
    update,
    destroy() {
      if (disposed) return;
      disposed = true;
      root.classList.remove('hometv-has-episodes');
      for (const { name, button, click } of controls) {
        button.removeEventListener('click', click);
        if (!art.isDestroy) art.controls.remove(name);
      }
    },
  };
}
