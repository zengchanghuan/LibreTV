import { liveChannelNameLines } from '@/lib/live-channel-name';

/** Give each language its own wrapping line, including in the narrow sidebar. */
export function LiveChannelName({ name, tone = 'default' }: { name: string; tone?: 'default' | 'video' }) {
  return <>{liveChannelNameLines(name).map((line, index) => (
    <span key={line} className={index === 0
      ? 'block whitespace-normal break-words leading-5'
      : `block whitespace-normal break-words text-xs font-normal leading-5 ${tone === 'video' ? 'text-white/85' : 'text-muted'}`}>{line}</span>
  ))}</>;
}
