import { describe, expect, it, vi } from 'vitest';
import { observeVideoResolution, readVideoResolution } from './player-resolution';

function makeVideo(width = 1920, height = 1080) {
  return Object.assign(new EventTarget(), {
    videoWidth: width, videoHeight: height, readyState: 1,
    getAttribute: vi.fn((): string | null => 'blob:playing-video'),
  }) as unknown as HTMLVideoElement;
}

describe('current playback resolution', () => {
  it.each([
    [1280, 720, '720p', null], [1920, 1080, '1080p', 'HD'], [3840, 2160, '2160p', '4K'],
    [7680, 4320, '4320p', '8K'], [2560, 1440, '1440p', 'HD'],
    [854, 480, '480p', null], [640, 360, '360p', null],
    [1920, 800, '800p', null], [1080, 1920, '1080p', 'HD'],
  ])('formats decoded %s × %s with a separate quality badge', (width, height, label, badge) => {
    expect(readVideoResolution(makeVideo(width, height))).toEqual({ label, badge, detail: `${width} × ${height}` });
  });

  it('hides missing metadata, audio-only media, and stale dimensions during source resolution', () => {
    expect(readVideoResolution(makeVideo(0, 0))).toBeNull();
    const video = makeVideo();
    Object.assign(video, { readyState: 0 });
    expect(readVideoResolution(video)).toBeNull();
    Object.assign(video, { readyState: 1, getAttribute: () => null });
    expect(readVideoResolution(video)).toBeNull();
  });

  it('updates on adaptive changes, clears on new media, and stops observing after unmount', () => {
    const video = makeVideo();
    const update = vi.fn();
    const dispose = observeVideoResolution(video, update);
    expect(update).toHaveBeenLastCalledWith({ label: '1080p', badge: 'HD', detail: '1920 × 1080' });
    Object.assign(video, { videoWidth: 1280, videoHeight: 720 });
    video.dispatchEvent(new Event('resize'));
    expect(update).toHaveBeenLastCalledWith({ label: '720p', badge: null, detail: '1280 × 720' });
    for (const event of ['emptied', 'loadstart', 'error']) {
      video.dispatchEvent(new Event(event));
      expect(update).toHaveBeenLastCalledWith(null);
      video.dispatchEvent(new Event('loadedmetadata'));
      expect(update).toHaveBeenLastCalledWith({ label: '720p', badge: null, detail: '1280 × 720' });
    }
    dispose(); update.mockClear();
    for (const event of ['resize', 'loadedmetadata', 'loadeddata', 'emptied', 'loadstart', 'error']) video.dispatchEvent(new Event(event));
    expect(update).not.toHaveBeenCalled();
  });
});
