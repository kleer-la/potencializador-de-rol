// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { followSystemTheme } from './theme.ts';

/** A stand-in for `matchMedia('(prefers-color-scheme: dark)')` the test can flip. */
function fakeQuery(matches: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  return {
    query: {
      get matches() {
        return matches;
      },
      addEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) => listeners.add(listener),
      removeEventListener: (_type: 'change', listener: (event: { matches: boolean }) => void) =>
        listeners.delete(listener),
    },
    flip(next: boolean) {
      matches = next;
      for (const listener of listeners) listener({ matches: next });
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  document.documentElement.removeAttribute('data-theme');
});

describe('followSystemTheme', () => {
  it('sets the theme from the system preference', () => {
    followSystemTheme(document.documentElement, fakeQuery(true).query);
    expect(document.documentElement.dataset.theme).toBe('dark');

    followSystemTheme(document.documentElement, fakeQuery(false).query);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows a change of preference while the page is open, until stopped', () => {
    const system = fakeQuery(false);

    const stop = followSystemTheme(document.documentElement, system.query);
    system.flip(true);
    const afterChange = document.documentElement.dataset.theme;
    stop();
    system.flip(false);

    expect(afterChange).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(system.listenerCount()).toBe(0);
  });
});
