'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useAuth } from '@/components/auth';
import { useFamily } from '@/components/family';
import { SourceManagerDrawer } from '@/components/source-manager';
import { requestShowDownloadManager } from '@/components/download-manager';
import { useTheme, type ThemeChoice } from '@/components/theme';

export default function SettingsPage() {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const { verified, openLogin, logout } = useAuth();
  const family = useFamily();
  const { theme, setTheme } = useTheme();
  const row = 'w-full min-h-14 px-4 py-3 flex items-center justify-between text-left border-b border-line last:border-0 hover:bg-hover';
  return <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
    <h1 className="text-2xl font-bold text-content">设置</h1>
    <section className="rounded-xl border border-line bg-surface-raised overflow-hidden">
      <button className={row} onClick={() => setSourcesOpen(true)}><span>视频源管理</span><span aria-hidden>›</span></button>
      <button className={row} onClick={family.open}><span>家庭成员与同步</span><span className="text-sm text-muted">{family.profile?.name || '仅本设备'} ›</span></button>
      <button className={row} onClick={requestShowDownloadManager}><span>下载管理</span><span aria-hidden>›</span></button>
      <label className={row}><span>外观</span><select aria-label="外观" value={theme} onChange={event => setTheme(event.target.value as ThemeChoice)} className="input text-sm">
        <option value="dark">深色</option><option value="light">浅色</option><option value="system">跟随系统</option>
      </select></label>
      <Link href="/about" className={row}><span>关于 LibreTV</span><span aria-hidden>›</span></Link>
    </section>
    <button className="btn-ghost w-full" onClick={() => verified ? void logout() : openLogin()}>{verified ? '退出登录' : '登录'}</button>
    <SourceManagerDrawer open={sourcesOpen} onClose={() => setSourcesOpen(false)} />
  </main>;
}
