'use client';

import { useEffect, useState } from 'react';
import { observeVideoResolution, type VideoResolution } from '@/lib/player-resolution';

export function PlaybackResolution({ video }: { video: HTMLVideoElement }) {
  const [resolution, setResolution] = useState<VideoResolution | null>(null);
  useEffect(() => observeVideoResolution(video, setResolution), [video]);
  if (!resolution) return null;
  const description = `清晰度档位：${resolution.label} · 实际分辨率：${resolution.detail}`;
  return <span className="playback-resolution" title={description} aria-label={description}>
    {resolution.label}{resolution.badge && <sup className="playback-resolution-badge">{resolution.badge}</sup>}
  </span>;
}
