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
    [1280, 720, '720p', 'HD'], [1920, 1080, '1080p', 'FHD'], [3840, 2160, '2160p', '4K'],
    [7680, 4320, '4320p', '8K'], [2560, 1440, '1440p', 'QHD'],
    [854, 480, '480p', null], [640, 360, '360p', null], [426, 240, '240p', null],
    [1080, 1920, '1080p', 'FHD'], [2160, 3840, '2160p', '4K'],
    [1920, 800, '1080p', 'FHD'], [3840, 1600, '2160p', '4K'],
    [1280, 536, '720p', 'HD'], [2560, 1080, '1440p', 'QHD'],
    [800, 1920, '1080p', 'FHD'], [1600, 3840, '2160p', '4K'],
    [3440, 1440, '1440p', null], [1440, 1080, '1080p', null],
    [1600, 900, '900p', null], [4096, 2160, '2160p', null],
    [1920, 1200, '1200p', null], [1000, 1000, '1000p', null],
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
    expect(update).toHaveBeenLastCalledWith({ label: '1080p', badge: 'FHD', detail: '1920 × 1080' });
    Object.assign(video, { videoWidth: 1280, videoHeight: 720 });
    video.dispatchEvent(new Event('resize'));
    expect(update).toHaveBeenLastCalledWith({ label: '720p', badge: 'HD', detail: '1280 × 720' });
    for (const event of ['emptied', 'loadstart', 'error']) {
      video.dispatchEvent(new Event(event));
      expect(update).toHaveBeenLastCalledWith(null);
      video.dispatchEvent(new Event('loadedmetadata'));
      expect(update).toHaveBeenLastCalledWith({ label: '720p', badge: 'HD', detail: '1280 × 720' });
    }
    dispose(); update.mockClear();
    for (const event of ['resize', 'loadedmetadata', 'loadeddata', 'emptied', 'loadstart', 'error']) video.dispatchEvent(new Event(event));
    expect(update).not.toHaveBeenCalled();
  });
});
