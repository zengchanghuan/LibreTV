'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AVATARS, PROFILE_KEY, type FamilyProfile } from '@/lib/family-types';
import { accountHistorySync, activeProfileId, activeSyncId, db } from '@/lib/db';
import { activeAccountId } from '@/lib/account-client';
import { importLocalHistory, syncFamily } from '@/lib/family-sync';
import { useAuth } from './auth';
import { Drawer } from './drawer';

const FamilyContext = createContext({ ready: false, profile: null as FamilyProfile | null, status: '', syncing: false,
  accountSync: false, synchronize: async () => {}, open: () => {} });
export const useFamily = () => useContext(FamilyContext);

export function FamilyButton() {
  const { profile, open, status, accountSync } = useFamily();
  return <button className="btn-ghost btn-sm" onClick={open} aria-label="播放历史与同步" title={status || '播放历史与同步'}>
    <span>{profile?.avatar || '☁️'}</span><span className="hidden sm:inline max-w-16 truncate">{profile?.name || (accountSync ? '账号同步' : '历史同步')}</span>
  </button>;
}

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { verified, username, openLogin } = useAuth();
  const [profiles, setProfiles] = useState<FamilyProfile[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<string>(AVATARS[0]);
  const current = profiles.find(profile => profile.id === activeProfileId) || null;
  const mounted = useRef(true);

  const refreshProfiles = async () => {
    const response = await fetch('/api/family', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || '无法获取家庭成员');
    if (mounted.current) setProfiles(data.profiles);
  };
  const synchronize = useCallback(async () => {
    if (mounted.current) { setSyncing(true); setStatus('正在同步播放历史…'); }
    try {
      const result = await syncFamily();
      if (mounted.current) setStatus(activeSyncId ? [
        result.pending ? `还有 ${result.pending} 条记录待同步` : `已同步 · ${new Date().toLocaleTimeString()}`,
        result.conflicts ? '同一记录的冲突已保留云端版本' : '',
        result.skipped ? `${result.skipped} 条旧记录格式待处理，原记录已备份` : '',
      ].filter(Boolean).join('；') : '当前仅保存在本设备，登录账号后自动同步');
    } catch (error) {
      if (mounted.current) setStatus(`暂未同步，记录保留在本机：${error instanceof Error ? error.message : '请稍后重试'}`);
    } finally { if (mounted.current) setSyncing(false); }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!verified) { setStatus('登录账号后自动同步播放历史'); if (!activeProfileId) setReady(true); return; }
    let cancelled = false;
    void refreshProfiles().catch(error => { if (!cancelled) setStatus(String(error.message)); });
    void synchronize().finally(() => { if (!cancelled) setReady(true); });
    let queued: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      // Throttle instead of debounce: continuous playback still syncs every ~5 seconds.
      if (!queued) queued = setTimeout(() => { queued = undefined; void synchronize(); }, 5000);
    };
    const visible = () => { if (!document.hidden) { void synchronize(); void refreshProfiles().catch(() => {}); } };
    const online = () => { void synchronize(); void refreshProfiles().catch(() => {}); };
    const interval = setInterval(() => { if (!document.hidden) void synchronize(); }, 15000);
    window.addEventListener('libretv:history-changed', changed);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', online);
    return () => {
      cancelled = true; clearInterval(interval); clearTimeout(queued);
      window.removeEventListener('libretv:history-changed', changed);
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', online);
    };
    // The selected profile/database are immutable until a deliberate page reload.
  }, [verified, synchronize]);

  const select = async (profile: FamilyProfile | null) => {
    setBusy(true);
    try {
      document.querySelectorAll('video').forEach(video => video.pause());
      // Wait for any progress writes queued by pause, then attempt their upload.
      await db.transaction('r', [db.history, db.progress, db.syncOutbox], async () => {});
      await syncFamily().catch(() => {});
      if (profile) localStorage.setItem(PROFILE_KEY, profile.id); else localStorage.removeItem(PROFILE_KEY);
      location.assign('/');
    } catch { setStatus('无法保存成员选择，请检查浏览器存储设置'); setBusy(false); }
  };

  const create = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/family', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, avatar }), signal: AbortSignal.timeout(8000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || '创建失败');
      await select(data.profile);
    } catch (error) { setStatus(error instanceof Error ? error.message : '创建失败'); setBusy(false); }
  };

  return <FamilyContext.Provider value={{ ready, profile: current, status, syncing, accountSync: verified && accountHistorySync, synchronize,
    open: () => { if (!verified) openLogin(); else { setOpen(true); void refreshProfiles().catch(error => setStatus(error.message)); } } }}>
    {children}
    <Drawer open={open} onClose={() => setOpen(false)} title="播放历史与同步">
      <p className="text-sm text-muted mb-4">{activeAccountId
        ? `账号 ${username || ''} 的播放历史和进度会自动同步到登录同一账号的设备；首次使用会自动补传本机原有记录，并保留一份本地备份。`
        : '登录独立账号后自动同步播放历史。使用共享密码时，可选择同一家庭成员同步。'}</p>
      {activeProfileId && <p className="text-sm text-muted mb-3">当前使用成员「{current?.name || '加载中'}」的独立记录，两台设备需选择同一成员。</p>}
      <p className="text-xs text-muted my-4" role="status">{status}</p>
      {activeSyncId && <button className="btn-ghost mb-4" disabled={busy || syncing} onClick={() => void synchronize()}>{syncing ? '同步中…' : '立即同步'}</button>}
      {activeAccountId && activeProfileId && <button className="btn-primary ml-2 mb-4" disabled={busy} onClick={() => void select(null)}>使用账号历史（自动同步）</button>}
      <details className="border-t border-line pt-4">
      <summary className="cursor-pointer text-sm text-muted mb-4">家庭成员（可选，分别保存记录）</summary>
      <div className="grid grid-cols-3 gap-3">
        {profiles.map(profile => <button key={profile.id} className={`rounded-xl border p-3 ${profile.id === activeProfileId ? 'border-accent bg-chip' : 'border-line'}`} disabled={busy} onClick={() => void select(profile)}>
          <span className="text-3xl block">{profile.avatar}</span><span className="text-sm block truncate mt-2">{profile.name}</span>
        </button>)}
      </div>
      {activeProfileId && <div className="flex flex-wrap gap-2 mb-5">
        <button className="btn-ghost" disabled={busy} onClick={async () => {
          setBusy(true);
          try { await importLocalHistory(); setStatus('本设备原有记录已导入当前成员，原记录仍保留'); }
          catch { setStatus('导入或同步暂未完成，请联网后重试'); }
          finally { setBusy(false); }
        }}>导入本设备原有历史</button>
      </div>}
      <form className="space-y-3 border-t border-line pt-4" onSubmit={event => { event.preventDefault(); void create(); }}>
        <label className="block text-sm">新成员名字<input className="input w-full mt-2" value={name} onChange={event => setName(event.target.value)} maxLength={24} required placeholder="例如：爸爸" /></label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="选择头像">{AVATARS.map(value => <button type="button" aria-label={`头像 ${value}`} aria-pressed={avatar === value} key={value} className={`p-2 text-2xl rounded-lg border ${avatar === value ? 'border-accent bg-chip' : 'border-transparent'}`} onClick={() => setAvatar(value)}>{value}</button>)}</div>
        <button className="btn-primary" disabled={busy || !name.trim()}>创建并使用</button>
      </form>
      {!activeAccountId && <button className="btn-ghost mt-5" disabled={busy} onClick={() => void select(null)}>仅使用本设备原有记录</button>}
      </details>
    </Drawer>
  </FamilyContext.Provider>;
}
