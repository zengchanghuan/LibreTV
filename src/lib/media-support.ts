export function hlsEngine(hlsSupported: boolean, nativeSupport: string): 'hls' | 'native' | 'unsupported' {
  if (hlsSupported) return 'hls';
  return nativeSupport ? 'native' : 'unsupported';
}

export function sleepTimerExpired(deadline: number | null, now: number): boolean {
  return deadline !== null && now >= deadline;
}

/** Reserve 30 seconds of wall-clock playback before competing for bandwidth. */
export function hasPlaybackHeadroom(video: Pick<HTMLVideoElement, 'buffered' | 'currentTime' | 'playbackRate' | 'readyState' | 'seeking'>): boolean {
  if (video.seeking || video.readyState < 3) return false;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= video.currentTime && video.currentTime < video.buffered.end(i)) {
      return video.buffered.end(i) - video.currentTime >= 30 * Math.max(1, video.playbackRate);
    }
  }
  return false;
}

export function isAppleMobile(): boolean {
  return typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
}
