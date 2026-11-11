'use client';

import Link from 'next/link';
import { useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './auth';
import { ThemeToggle } from './theme';
import { SourceManagerDrawer } from './source-manager';
import { HistoryPanel } from './history-panel';
import { requestShowDownloadManager } from './download-manager';
import { Icon } from './icon';
import { SearchHistoryDropdown, useSearchHistory } from './search-history';
import { cn } from '@/lib/utils';
import { InstallBanner, InstallButton, PwaUpdateBanner } from './pwa';
import { FamilyButton } from './family';
import { useNativeApp } from './native-player';

/** 顶部导航：Logo、搜索框（首页外）、历史、设置 */
export function Header({ showSearch = false }: { showSearch?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const { checked, verified, username, logout, openLogin } = useAuth();
  const native = useNativeApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [query, setQuery] = useState('');
  // 与首页搜索框共用同一套「最近搜索」下拉逻辑
  const searchHistory = useSearchHistory(query);

  const submitSearch = (text: string) => {
    const q = text.trim().slice(0, 100);
    if (!q) return;
    searchHistory.close();
    router.push(`/?s=${encodeURIComponent(q)}`, { scroll: false });
    // 顶栏搜索一并写入最近搜索（此前只有首页会记录）
    searchHistory.record(q);
  };

  const pickHistory = (text: string) => {
    setQuery(text);
    submitSearch(text);
  };

  return (
    <>
      <header className="sticky top-0 z-40 bg-surface/90 backdrop-blur border-b border-line">
        <PwaUpdateBanner />
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center gap-3">
          <Link href="/" aria-label="HomeTV 首页" className="flex items-center gap-2 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-512.png" alt="HomeTV" className="w-7 h-7 rounded-lg" />
            {native && <span className="text-lg font-semibold tracking-tight sm:hidden">HomeTV</span>}
          </Link>

          {showSearch && (
            <form
              className="flex-1 max-w-xl hidden sm:block"
              onSubmit={(e) => {
                e.preventDefault();
                submitSearch(query);
              }}
            >
              <div ref={searchHistory.containerRef} className="relative">
                <input
                  className={cn(
                    'input w-full h-9 pr-10',
                    // 展开时：上圆角与外框沿用聚焦样式，底边改为内部分隔线，与下拉拼成同一面板
                    searchHistory.visible &&
                      'rounded-b-none border-accent border-b-line bg-surface-raised focus-visible:ring-0'
                  )}
                  aria-label="搜索影片"
                  placeholder="搜索影片..."
                  value={query}
                  maxLength={100}
                  autoComplete="off"
                  onChange={(e) => {
                    setQuery(e.target.value);
                    searchHistory.onInputChange();
                  }}
                  onFocus={searchHistory.onFocus}
                  onClick={searchHistory.onFocus}
                  onKeyDown={(e) => searchHistory.onKeyDown(e, pickHistory)}
                  role="combobox"
                  aria-expanded={searchHistory.visible}
                  aria-controls="header-search-history"
                  aria-autocomplete="list"
                  aria-activedescendant={
                    searchHistory.visible && searchHistory.activeIndex >= 0
                      ? `header-search-history-${searchHistory.activeIndex}`
                      : undefined
                  }
                />
                <button
                  type="button"
                  className="absolute right-1 top-0.5 p-2 rounded-md text-faint hover:text-content hover:bg-hover"
                  aria-label="搜索历史"
                  title="搜索历史"
                  aria-expanded={searchHistory.visible}
                  aria-controls="header-search-history"
                  onClick={searchHistory.toggle}
                >
                  <Icon name="clock" className="w-4 h-4" />
                </button>
                {searchHistory.visible && (
                  <SearchHistoryDropdown
                    id="header-search-history"
                    matches={searchHistory.matches}
                    activeIndex={searchHistory.activeIndex}
                    onPick={pickHistory}
                    onRemove={searchHistory.remove}
                    onClearAll={searchHistory.clearAll}
                    hasHistory={searchHistory.hasHistory}
                    emptyText={searchHistory.emptyText}
                  />
                )}
              </div>
            </form>
          )}

          <div className="flex-1 sm:hidden" />

          <nav className="flex items-center gap-1 ml-auto">
            {checked && !verified && <button type="button" className="min-h-11 px-2 text-sm text-accent sm:hidden" onClick={openLogin}>登录</button>}
            {!native && <span className="hidden sm:contents"><InstallButton /><FamilyButton /></span>}
            {!native && <HeaderLink href="/hd" active={pathname === '/hd'}>高清</HeaderLink>}
            {!native && <HeaderLink href="/live" active={pathname === '/live'}>
              直播
            </HeaderLink>}
            {!native && <><span className="hidden sm:contents"><HeaderLink href="/about" active={pathname === '/about'}>
              关于
            </HeaderLink></span>
            <span className="hidden sm:contents"><ThemeToggle /></span></>}
            <IconButton label="观看历史" onClick={() => setHistoryOpen(true)}>
              <Icon name="clock" />
              {native && <span className="text-sm">历史</span>}
            </IconButton>
            {!native && <><span className="hidden sm:contents"><IconButton label="下载管理" onClick={requestShowDownloadManager}>
              <Icon name="download" />
            </IconButton></span>
            <IconButton label="设置" onClick={() => window.matchMedia('(max-width: 639px)').matches ? router.push('/settings') : setSettingsOpen(true)}>
              <Icon name="gear" />
            </IconButton></>}
          </nav>
        </div>
        {pathname === '/' && checked && !native && (
          <div className="max-w-6xl mx-auto px-4 pb-1 hidden sm:flex items-center justify-end gap-3 text-sm">
            {verified && <span className="truncate text-muted">当前账号 · {username || '共享访问'}</span>}
            <button type="button" className="btn-ghost shrink-0" onClick={verified ? logout : openLogin}>
              {verified ? '退出登录' : '账号登录'}
            </button>
          </div>
        )}
        {!native && <InstallBanner />}
      </header>

      <SourceManagerDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <HistoryPanel open={historyOpen} onClose={() => setHistoryOpen(false)} />
    </>
  );
}

function HeaderLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className={cn(
        'px-2.5 py-1.5 rounded-md text-sm transition-colors',
        active ? 'text-content bg-hover' : 'text-muted hover:text-content'
      )}
    >
      {children}
    </Link>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      className="inline-flex items-center justify-center gap-1 p-2 rounded-md text-muted hover:text-content hover:bg-hover transition-colors"
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
