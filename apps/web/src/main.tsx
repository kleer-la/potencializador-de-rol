import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './design-system/fonts.ts';
import './design-system/tokens.css';
import './design-system/components.css';
import './styles.css';
import { followSystemTheme } from './design-system/theme.ts';

followSystemTheme(document.documentElement, window.matchMedia('(prefers-color-scheme: dark)'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
