import { describe, expect, it, vi } from 'vitest';
import type Artplayer from 'artplayer';
import { bindEpisodeControls } from './player-episode-controls';

class Button extends EventTarget {
  disabled = false;
  parentElement = { style: { display: '' } };
  attributes: Record<string, string> = {};
  setAttribute(name: string, value: string) { this.attributes[name] = value; }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}

function fixture(count = 3, index = 1) {
  const buttons = new Map<string, Button>();
  const classes = new Set<string>();
  const add = vi.fn(({ name, html }: { name: string; html: Button }) => { buttons.set(name, html); });
  const remove = vi.fn((name: string) => buttons.delete(name));
  const art = {
    template: { $player: {
      ownerDocument: { createElement: () => new Button() },
      classList: {
        toggle(name: string, enabled: boolean) { if (enabled) classes.add(name); else classes.delete(name); },
        remove(name: string) { classes.delete(name); },
      },
    } },
    controls: { add, remove },
    isDestroy: false,
  };
  const onEpisode = vi.fn();
  const binding = bindEpisodeControls(art as unknown as Artplayer, { count, index, onEpisode });
  return { ...binding, art, add, remove, onEpisode, classes,
    previous: buttons.get('episode-previous')!, next: buttons.get('episode-next')!,
  };
}

describe('episode transport controls', () => {
  it('places adjacent-episode buttons around the existing play control', () => {
    const f = fixture();
    expect(f.add.mock.calls.map(([option]) => option)).toEqual([
      expect.objectContaining({ name: 'episode-previous', position: 'left', index: 5 }),
      expect.objectContaining({ name: 'episode-next', position: 'left', index: 15 }),
    ]);
    expect(f.previous.attributes['aria-label']).toBe('上一集');
    expect(f.next.attributes['aria-label']).toBe('下一集');
    f.previous.click(); f.next.click();
    expect(f.onEpisode.mock.calls).toEqual([[0], [2]]);
  });

  it('disables the unavailable direction at the first and last episodes', () => {
    const f = fixture(3, 0);
    expect(f.previous.disabled).toBe(true);
    expect(f.next.disabled).toBe(false);
    f.previous.click();
    expect(f.onEpisode).not.toHaveBeenCalled();
    f.update({ count: 3, index: 2, onEpisode: f.onEpisode });
    expect(f.previous.disabled).toBe(false);
    expect(f.next.disabled).toBe(true);
    f.next.click(); f.previous.click();
    expect(f.onEpisode.mock.calls).toEqual([[1]]);
  });

  it.each([0, 1])('hides both controls with %i episodes and restores them when a series loads', count => {
    const f = fixture(count, 0);
    expect(f.previous.parentElement.style.display).toBe('none');
    expect(f.next.parentElement.style.display).toBe('none');
    expect(f.classes.has('hometv-has-episodes')).toBe(false);
    f.next.click();
    expect(f.onEpisode).not.toHaveBeenCalled();
    f.update({ count: 4, index: 1, onEpisode: f.onEpisode });
    expect(f.next.parentElement.style.display).toBe('');
    expect(f.classes.has('hometv-has-episodes')).toBe(true);
    f.next.click();
    expect(f.onEpisode).toHaveBeenCalledWith(2);
  });

  it('uses the latest episode and callback without recreating controls', () => {
    const f = fixture();
    const callback = vi.fn();
    f.update({ count: 10, index: 7, onEpisode: callback });
    f.previous.click(); f.next.click();
    expect(f.onEpisode).not.toHaveBeenCalled();
    expect(callback.mock.calls).toEqual([[6], [8]]);
    expect(f.add).toHaveBeenCalledTimes(2);
    f.update({ count: 10, index: 7 });
    expect(f.next.parentElement.style.display).toBe('none');
    expect(f.next.disabled).toBe(true);
  });

  it('removes controls and callbacks on cleanup, which is safe to repeat', () => {
    const f = fixture();
    f.destroy(); f.destroy();
    f.next.click();
    f.update({ count: 5, index: 2, onEpisode: f.onEpisode });
    expect(f.onEpisode).not.toHaveBeenCalled();
    expect(f.remove.mock.calls).toEqual([['episode-previous'], ['episode-next']]);
    expect(f.classes.has('hometv-has-episodes')).toBe(false);
  });

  it('cleans up after the player has already been destroyed', () => {
    const f = fixture();
    f.art.isDestroy = true;
    f.destroy(); f.next.click();
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.onEpisode).not.toHaveBeenCalled();
  });
});
