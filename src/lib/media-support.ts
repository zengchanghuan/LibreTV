export function hlsEngine(hlsSupported: boolean, nativeSupport: string): 'hls' | 'native' | 'unsupported' {
  if (hlsSupported) return 'hls';
  return nativeSupport ? 'native' : 'unsupported';
}

export function sleepTimerExpired(deadline: number | null, now: number): boolean {
  return deadline !== null && now >= deadline;
}

export function isAppleMobile(): boolean {
  return typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
}
