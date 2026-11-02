'use client';

import type { ReactNode } from 'react';
import { BRAND_LOGO } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { Icon, type IconName } from './icon';

/**
 * 全站统一的状态呈现：加载中 / 空态 / 错误态。
 * 此前各处以 h-5/h-8/h-9 × border-2/3/4 的多种 spinner、
 * 「图标+标题」/「虚线框」/`❌` emoji / 纯文字四种空态混用，这里收敛为三个组件。
 */

const SPINNER_SIZE = {
  sm: 'w-4 h-4',
  md: 'w-8 h-8',
  lg: 'w-12 h-12',
} as const;

export function Spinner({
  size = 'md',
  tone = 'default',
  className,
}: {
  size?: keyof typeof SPINNER_SIZE;
  /** onDark：播放器错误层等深色背景之上 */
  tone?: 'default' | 'onDark';
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={BRAND_LOGO}
      alt=""
      width={96}
      height={96}
      className={cn(
        'hometv-loading-logo inline-block rounded-lg shrink-0 object-contain',
        SPINNER_SIZE[size],
        tone === 'onDark' && 'drop-shadow-lg',
        className
      )}
      aria-hidden
    />
  );
}

/** 加载中：spinner + 可选文案（替代各处「纯文字 加载中...」） */
export function LoadingState({ label, className }: { label?: string; className?: string }) {
  return (
    <div role="status" aria-label={label || '加载中'} className={cn('flex flex-col items-center justify-center gap-3 py-10', className)}>
      <Spinner size="md" />
      {label && <p className="text-sm text-muted">{label}</p>}
    </div>
  );
}

export function EmptyState({
  icon = 'link',
  title,
  description,
  action,
  /** boxed：虚线框引导（列表为空）；plain：单行文字（筛选无结果等） */
  variant = 'boxed',
  className,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: 'boxed' | 'plain';
  className?: string;
}) {
  if (variant === 'plain') {
    return <p className={cn('text-center text-xs text-faint py-6', className)}>{title}</p>;
  }
  return (
    <div className={cn('border border-dashed border-line rounded-lg p-6 text-center', className)}>
      <Icon name={icon} className="w-6 h-6 mx-auto text-faint mb-2" />
      <p className="text-sm text-muted">{title}</p>
      {description && <p className="text-xs text-faint mt-1 leading-relaxed">{description}</p>}
      {action && <div className="mt-3 flex items-center justify-center gap-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = '重试',
  tone = 'default',
  className,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  tone?: 'default' | 'onDark';
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 py-8 text-center', className)}>
      <Icon name="alert" className={cn('w-6 h-6', tone === 'onDark' ? 'text-white/80' : 'text-danger')} />
      <p className={cn('text-sm break-words max-w-md', tone === 'onDark' ? 'text-white/80' : 'text-muted')}>
        {message}
      </p>
      {onRetry && (
        <button
          className={cn('btn-ghost btn-sm', tone === 'onDark' && '!bg-white/10 !text-white !border-white/20')}
          onClick={onRetry}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/** 起播占位与缓冲共用当前品牌 logo，避免旧品牌文字残留在位图中。 */
export function PlayerLoadingState() {
  return (
    <div role="status" aria-label="正在加载视频" className="absolute inset-0 bg-black pointer-events-none flex flex-col items-center justify-center gap-3">
      <Spinner size="lg" tone="onDark" />
      <span className="text-xl font-semibold text-white">HomeTV</span>
      <span className="text-xs text-white/60">正在加载视频…</span>
    </div>
  );
}
