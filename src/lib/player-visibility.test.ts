import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindPlaybackVisibility } from './player-visibility';

describe('playback across tabs and page navigation', () => {
  let hidden: boolean;
  let video: HTMLVideoElement;
  let cleanup: () => void;
  beforeEach(() => {
    hidden = false;
    const doc = new EventTarget();
    Object.defineProperty(doc, 'hidden', { get: () => hidden });
    vi.stubGlobal('document', doc);
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

  it('keeps playing when a new tab hides the player and when returning', () => {
    visibility(true);
    expect(video.paused).toBe(false);
    expect(video.currentTime).toBe(123);
    visibility(false);
    expect(video.pause).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
  });
  it('allows delayed playback and buffering recovery in a background tab', () => {
    visibility(true);
    video.play();
    video.dispatchEvent(new Event('playing'));
    expect(video.paused).toBe(false);
    expect(video.pause).not.toHaveBeenCalled();
  });
  it('does not resume a manual pause when switching tabs or returning', () => {
    video.pause();
    visibility(true);
    visibility(false);
    window.dispatchEvent(new Event('pageshow'));
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
  });
  it('pauses on pagehide and blocks late playback after leaving the page', () => {
    window.dispatchEvent(new Event('pagehide'));
    expect(video.paused).toBe(true);
    video.play();
    expect(video.paused).toBe(true);
    vi.mocked(video.pause).mockClear();
    video.dispatchEvent(new Event('playing'));
    expect(video.pause).toHaveBeenCalledOnce();
  });
  it('keeps a restored page paused until playback is requested', () => {
    window.dispatchEvent(new Event('pagehide'));
    visibility(true);
    window.dispatchEvent(new Event('pageshow'));
    expect(video.paused).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
    video.play();
    expect(video.paused).toBe(false);
  });
  it('does not interrupt a player mounted in a background tab', () => {
    cleanup(); hidden = true;
    cleanup = bindPlaybackVisibility(video);
    expect(video.pause).not.toHaveBeenCalled();
    video.dispatchEvent(new Event('playing'));
    expect(video.paused).toBe(false);
  });
  it('leaves visible playback and scrolling mini windows playing', () => {
    visibility(false);
    window.dispatchEvent(new Event('scroll'));
    video.dispatchEvent(new Event('playing'));
    expect(video.pause).not.toHaveBeenCalled();
  });
  it('removes navigation and media listeners when disposed', () => {
    cleanup();
    window.dispatchEvent(new Event('pagehide'));
    window.dispatchEvent(new Event('pageshow'));
    video.dispatchEvent(new Event('play'));
    video.dispatchEvent(new Event('playing'));
    expect(video.pause).not.toHaveBeenCalled();
  });
});
