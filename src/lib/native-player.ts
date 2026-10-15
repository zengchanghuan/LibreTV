'use client';

export interface NativeSession {
  id: string; title: string; sourceKey: string; sourceUrl?: string; vodId: string;
  profileId: string | null; index: number; episodes: { url: string; title: string; position: number }[];
  rate: number; autoplayNext: boolean; baseRevision: number; openedAt: number;
}
export interface NativeProgress {
  eventId: string; sessionId: string; profileId: string | null; sourceKey: string; sourceUrl?: string;
  vodId: string; title: string; index: number; total: number; position: number; duration: number;
  sequence: number; baseRevision: number; openedAt: number; ended: boolean; reason: string;
  rate?: number;
}
declare global {
  interface Window {
    __LIBRETV_NATIVE__?: { version: number; platform: string; postMessage: (message: unknown) => void };
  }
}
export function isNativeApp(): boolean {
  return typeof window !== 'undefined' && (!!window.__LIBRETV_NATIVE__ || /LibreTVNative\/1/.test(navigator.userAgent));
}
export function nativePost(message: unknown): boolean {
  if (typeof window === 'undefined' || window.__LIBRETV_NATIVE__?.version !== 1) return false;
  window.__LIBRETV_NATIVE__.postMessage(message); return true;
}
export function parseNativeProgress(value: unknown): NativeProgress | null {
  if (!value || typeof value !== 'object') return null;
  const p = value as NativeProgress;
  const text = (v: unknown, max: number) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!text(p.eventId, 160) || !text(p.sessionId, 80) || !text(p.sourceKey, 256) || !text(p.vodId, 2048) || !text(p.title, 512)) return null;
  if (p.profileId !== null && !(typeof p.profileId === 'string' && /^[a-f0-9-]{36}$/.test(p.profileId))) return null;
  if (p.sourceUrl !== undefined && !(typeof p.sourceUrl === 'string' && /^https?:\/\//.test(p.sourceUrl) && p.sourceUrl.length <= 4096)) return null;
  if (![p.index, p.total, p.sequence, p.baseRevision, p.openedAt].every(v => Number.isSafeInteger(v) && v >= 0)) return null;
  if (p.total < 1 || p.total > 10000 || p.index >= p.total || ![p.position, p.duration].every(v => Number.isFinite(v) && v >= 0 && v <= 864000)) return null;
  if (typeof p.ended !== 'boolean' || !['progress', 'pause', 'episode', 'ended', 'sleep', 'close', 'error'].includes(p.reason)) return null;
  return p;
}
