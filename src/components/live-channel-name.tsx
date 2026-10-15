import { liveChannelNameLines } from '@/lib/live-channel-name';

/** Give each language its own wrapping line, including in the narrow sidebar. */
export function LiveChannelName({ name }: { name: string }) {
  return <>{liveChannelNameLines(name).map((line, index) => (
    <span key={line} className={index === 0
      ? 'block whitespace-normal break-words leading-5'
      : 'block whitespace-normal break-words text-xs font-normal text-muted leading-5'}>{line}</span>
  ))}</>;
}
