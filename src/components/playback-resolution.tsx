'use client';

import { useEffect, useState } from 'react';
import { observeVideoResolution, type VideoResolution } from '@/lib/player-resolution';

export function PlaybackResolution({ video }: { video: HTMLVideoElement }) {
  const [resolution, setResolution] = useState<VideoResolution | null>(null);
  useEffect(() => observeVideoResolution(video, setResolution), [video]);
  if (!resolution) return null;
  return <span className="playback-resolution" title={`当前分辨率：${resolution.detail}`} aria-label={`当前分辨率：${resolution.detail}`}>
    {resolution.label}
  </span>;
}
