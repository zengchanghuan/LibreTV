import { MEDIA_TYPE_LABELS, type MediaType } from '@/lib/media-type';
import { cn } from '@/lib/utils';

export function MediaTypeLabel({ type, overlay = false }: { type: MediaType; overlay?: boolean }) {
  return (
    <span
      aria-label={`内容类型：${MEDIA_TYPE_LABELS[type]}`}
      className={cn(
        'shrink-0 whitespace-nowrap text-xs',
        overlay
          ? 'absolute top-2 right-2 font-medium text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]'
          : 'text-muted'
      )}
    >
      {MEDIA_TYPE_LABELS[type]}
    </span>
  );
}
