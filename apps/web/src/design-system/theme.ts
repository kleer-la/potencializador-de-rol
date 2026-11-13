/** The part of `MediaQueryList` the theme needs; a stand-in in tests. */
export type ColorSchemeQuery = {
  readonly matches: boolean;
  addEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
  removeEventListener(type: 'change', listener: (event: { matches: boolean }) => void): void;
};

/**
 * The design system selects its dark theme with `data-theme="dark"` (tokens.css). This
 * sets it from the person's system preference and follows changes; returns how to stop.
 */
export function followSystemTheme(root: HTMLElement, prefersDark: ColorSchemeQuery): () => void {
  const apply = (dark: boolean) => {
    root.dataset.theme = dark ? 'dark' : 'light';
  };
  const onChange = (event: { matches: boolean }) => apply(event.matches);
  apply(prefersDark.matches);
  prefersDark.addEventListener('change', onChange);
  return () => prefersDark.removeEventListener('change', onChange);
}
