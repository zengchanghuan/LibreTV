import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindPlaybackVisibility } from './player-visibility';

describe('playback when the screen locks or the page is hidden', () => {
  let hidden: boolean;
  let video: HTMLVideoElement;
  let cleanup: () => void;
  beforeEach(() => {
    hidden = false;
    vi.stubGlobal('document', Object.assign(new EventTarget(), {
      get hidden() { return hidden; },
    }));
    Object.defineProperty(document, 'hidden', { get: () => hidden });
    vi.stubGlobal('window', new EventTarget());
    const media = Object.assign(new EventTarget(), {
      paused: false, currentTime: 123,
      pause: vi.fn(() => { media.paused = true; }),
      play: vi.fn(() => { media.paused = false; media.dispatchEvent(new Event('play')); }),
    });
    video = media as unknown as HTMLVideoElement;
    cleanup = bindPlaybackVisibility(video);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  const visibility = (value: boolean) => {
    hidden = value;
    document.dispatchEvent(new Event('visibilitychange'));
  };

  it('pauses on lock without resetting progress and stays paused on unlock', () => {
    visibility(true);
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(123);
    visibility(false);
    window.dispatchEvent(new Event('pageshow'));
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    video.play();
    expect(video.paused).toBe(false);
  });
  it('stops delayed autoplay and recovery while hidden', () => {
    visibility(true);
    video.play();
    expect(video.paused).toBe(true);
    vi.mocked(video.pause).mockClear();
    video.dispatchEvent(new Event('playing'));
    expect(video.pause).toHaveBeenCalledOnce();
  });
  it('pauses pagehide even before visibility changes and allows play after pageshow', () => {
    window.dispatchEvent(new Event('pagehide'));
    video.play();
    expect(video.paused).toBe(true);
    window.dispatchEvent(new Event('pageshow'));
    expect(video.paused).toBe(true);
    video.play();
    expect(video.paused).toBe(false);
  });
  it('leaves visible playback and scrolling mini windows playing', () => {
    visibility(false);
    window.dispatchEvent(new Event('scroll'));
    video.dispatchEvent(new Event('playing'));
    expect(video.pause).not.toHaveBeenCalled();
  });
  it('pauses a player mounted while already hidden', () => {
    cleanup(); hidden = true;
    cleanup = bindPlaybackVisibility(video);
    expect(video.paused).toBe(true);
  });
  it('removes all listeners when disposed', () => {
    cleanup();
    visibility(true);
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
    expect(video.pause).not.toHaveBeenCalled();
  });
});
