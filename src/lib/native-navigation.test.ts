import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

// Run the actual script injected by WKWebView, rather than a second implementation.
const source = readFileSync(new URL('../../mobile/ios/HomeTV/NativeNavigation.swift', import.meta.url), 'utf8');
const script = source.match(/static let script = """([\s\S]*?)"""/)![1];

function browser() {
  const messages: { type: string; url: string }[] = [];
  const location = { href: 'https://tv.example.com/settings' };
  const listeners = new Map<string, (() => void)[]>();
  const history = {
    state: null as unknown,
    pushState: vi.fn(function(this: { state: unknown }, state: unknown, _title: string, url?: string) {
      this.state = state;
      if (url) location.href = new URL(url, location.href).href;
      return 'original-push-result';
    }),
    replaceState: vi.fn(function(this: { state: unknown }, state: unknown, _title: string, url?: string) {
      this.state = state;
      if (url) location.href = new URL(url, location.href).href;
      return 'original-replace-result';
    }),
  };
  const window = {
    __LIBRETV_NATIVE__: { postMessage: (message: { type: string; url: string }) => messages.push(message) },
    addEventListener: (name: string, listener: () => void) => listeners.set(name, [...(listeners.get(name) || []), listener]),
  };
  runInNewContext(script, { window, history, location });
  return { messages, location, history, window, emit: (name: string) => listeners.get(name)?.forEach(listener => listener()) };
}

describe('WKWebView SPA navigation notifications', () => {
  it('reports the initial route and settings → about → live client navigation', () => {
    const b = browser();
    b.history.pushState({ next: true }, '', '/about');
    b.history.pushState({ next: true }, '', '/live');
    expect(b.messages.map(message => message.url)).toEqual([
      'https://tv.example.com/settings', 'https://tv.example.com/about', 'https://tv.example.com/live',
    ]);
    expect(b.messages.every(message => message.type === 'navigation')).toBe(true);
  });
  it('preserves state, this binding and return values for push and replace', () => {
    const b = browser(), state = { __NA: true, tree: ['route'] };
    expect(b.history.pushState(state, '', '/live')).toBe('original-push-result');
    expect(b.history.state).toBe(state);
    expect(b.history.replaceState(state, '', '/?s=movie')).toBe('original-replace-result');
    expect(b.history.state).toBe(state);
    expect(b.messages.at(-1)?.url).toBe('https://tv.example.com/?s=movie');
  });
  it.each(['popstate', 'pageshow', 'hashchange'])('reports the current URL after %s', event => {
    const b = browser();
    b.location.href = 'https://tv.example.com/';
    b.emit(event);
    expect(b.messages.at(-1)?.url).toBe('https://tv.example.com/');
  });
  it('does not break navigation when bridge delivery fails', () => {
    const b = browser();
    b.window.__LIBRETV_NATIVE__.postMessage = () => { throw new Error('bridge unavailable'); };
    expect(() => b.history.pushState({}, '', '/live')).not.toThrow();
    expect(b.location.href).toBe('https://tv.example.com/live');
  });
});
