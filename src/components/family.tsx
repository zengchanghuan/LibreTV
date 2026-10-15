'use client';

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AVATARS, PROFILE_KEY, type FamilyProfile } from '@/lib/family-types';
import { activeProfileId, db } from '@/lib/db';
import { importLocalHistory, syncFamily } from '@/lib/family-sync';
import { useAuth } from './auth';
import { Drawer } from './drawer';

const FamilyContext = createContext({ ready: false, profile: null as FamilyProfile | null, open: () => {} });
export const useFamily = () => useContext(FamilyContext);

export function FamilyButton() {
  const { profile, open } = useFamily();
  return <button className="btn-ghost btn-sm" onClick={open} aria-label="选择家庭成员" title={profile?.name || '选择家庭成员'}>
    <span>{profile?.avatar || '👤'}</span><span className="hidden sm:inline max-w-16 truncate">{profile?.name || '成员'}</span>
  </button>;
}

export function FamilyProvider({ children }: { children: ReactNode }) {
  const { verified, openLogin } = useAuth();
  const [profiles, setProfiles] = useState<FamilyProfile[]>([]);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
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
  const synchronize = async () => {
    try {
      const result = await syncFamily();
      if (mounted.current) setStatus(activeProfileId ? result.conflicts ? '已同步；冲突记录保留了服务器上的新版本' : `已同步 · ${new Date().toLocaleTimeString()}` : '当前仅保存在本设备');
    } catch (error) {
      if (mounted.current) setStatus(`暂未同步，记录保留在本机：${error instanceof Error ? error.message : '请稍后重试'}`);
    }
  };

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!verified) { if (!activeProfileId) setReady(true); return; }
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
  }, [verified]);

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

  return <FamilyContext.Provider value={{ ready, profile: current, open: () => { if (!verified) openLogin(); else { setOpen(true); void refreshProfiles().catch(error => setStatus(error.message)); } } }}>
    {children}
    <Drawer open={open} onClose={() => setOpen(false)} title="谁在观看？">
      <p className="text-sm text-muted mb-4">每台设备选择同一头像，即可同步该成员的历史和进度。家庭成员共用访问密码，头像用于区分记录。</p>
      <div className="grid grid-cols-3 gap-3">
        {profiles.map(profile => <button key={profile.id} className={`rounded-xl border p-3 ${profile.id === activeProfileId ? 'border-accent bg-chip' : 'border-line'}`} disabled={busy} onClick={() => void select(profile)}>
          <span className="text-3xl block">{profile.avatar}</span><span className="text-sm block truncate mt-2">{profile.name}</span>
        </button>)}
      </div>
      <p className="text-xs text-muted my-4" role="status">{status}</p>
      {activeProfileId && <div className="flex flex-wrap gap-2 mb-5">
        <button className="btn-ghost" disabled={busy} onClick={() => void synchronize()}>立即同步</button>
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
      <button className="btn-ghost mt-5" disabled={busy} onClick={() => void select(null)}>仅使用本设备原有记录</button>
    </Drawer>
  </FamilyContext.Provider>;
}
