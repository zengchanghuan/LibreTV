'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icon';
import { useFocusTrap } from './use-focus-trap';
import { nativePost } from '@/lib/native-player';
import styles from './collection-picker.module.css';

export type CollectionDirectory = 'topics' | 'directors' | 'actors';
export interface CollectionOption { id: string; name: string; fullName?: string }
export const collectionDirectoryLabels = [['topics', '主题片单'], ['directors', '导演'], ['actors', '演员']] as const;
export function filterCollections(options: readonly CollectionOption[], query: string) {
  const key = query.normalize('NFKC').trim().toLocaleLowerCase();
  return options.filter(option => `${option.name} ${option.fullName || ''}`.normalize('NFKC').toLocaleLowerCase().includes(key));
}

export function CollectionPicker({ directories, directory, selected, onSelect, onClose }: {
  directories: Record<CollectionDirectory, readonly CollectionOption[]>;
  directory: CollectionDirectory; selected: string;
  onSelect: (directory: CollectionDirectory, id: string) => void; onClose: () => void;
}) {
  const [tab, setTab] = useState(directory);
  const [query, setQuery] = useState('');
  const panel = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const close = useRef(onClose); close.current = onClose;
  useFocusTrap(true, panel);
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const background = Array.from(document.body.children).filter((node): node is HTMLElement => node instanceof HTMLElement && node !== overlay.current);
    const previousInert = background.map(node => node.inert);
    background.forEach(node => { node.inert = true; });
    nativePost({ type: 'collectionSheet', open: true });
    const viewport = window.visualViewport;
    const resize = () => {
      if (!overlay.current || !viewport) return;
      overlay.current.style.height = `${viewport.height}px`;
      overlay.current.style.top = `${viewport.offsetTop}px`;
    };
    resize(); viewport?.addEventListener('resize', resize); viewport?.addEventListener('scroll', resize);
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); } };
    const desktop = window.matchMedia('(min-width: 640px)');
    const leaveMobile = () => { if (desktop.matches) close.current(); };
    window.addEventListener('keydown', escape); desktop.addEventListener('change', leaveMobile);
    return () => {
      document.body.style.overflow = previousOverflow;
      background.forEach((node, index) => { node.inert = previousInert[index]; });
      // Restore after background inert is removed (the focus-trap cleanup may run first).
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-collection-trigger]')?.focus());
      nativePost({ type: 'collectionSheet', open: false });
      viewport?.removeEventListener('resize', resize); viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('keydown', escape); desktop.removeEventListener('change', leaveMobile);
    };
  }, []);
  useEffect(() => { if (list.current) list.current.scrollTop = 0; }, [tab, query]);
  const matches = filterCollections(directories[tab], query);
  return createPortal(<div ref={overlay} className={styles.overlay} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="collection-picker-title" tabIndex={-1} className={styles.sheet}>
      <div className={styles.handle} aria-hidden="true" />
      <div className={styles.heading}><h2 id="collection-picker-title">选择片单</h2><button type="button" className={styles.close} aria-label="关闭片单选择" onClick={onClose}><Icon name="close" className="w-5 h-5" /></button></div>
      <div className={styles.tabs} role="group" aria-label="片单分类">{collectionDirectoryLabels.map(([key, label]) => <button type="button" key={key} aria-pressed={tab === key} onClick={() => { setTab(key); setQuery(''); }}>{label}</button>)}</div>
      <label className={styles.search}><Icon name="search" className="w-4 h-4 shrink-0" /><input type="search" autoComplete="off" aria-label={tab === 'topics' ? '搜索片单名称' : '搜索人物名称'} placeholder={tab === 'topics' ? '搜索片单名称' : '搜索人物名称'} value={query} onChange={event => setQuery(event.target.value)} /></label>
      <div ref={list} className={styles.list} aria-label="片单列表">{matches.map(option => <button type="button" key={option.id} aria-pressed={option.id === selected && tab === directory} onClick={() => { onSelect(tab, option.id); onClose(); }}>
        <span>{option.name.endsWith('TOP 30') ? <>{option.name.slice(0, -6)}<span className="whitespace-nowrap">TOP 30</span></> : option.name}</span><span className="w-5 shrink-0">{option.id === selected && tab === directory && <Icon name="check" className="w-5 h-5" />}</span>
      </button>)}{!matches.length && <p className={styles.empty} role="status">没有找到匹配的{tab === 'topics' ? '片单' : '人物'}</p>}</div>
    </div>
  </div>, document.body);
}
