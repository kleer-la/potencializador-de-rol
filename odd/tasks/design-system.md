# Design system in the web application

Objective: the web application uses the design system published as the artifact "Potencializador de rol" (https://claude.ai/artifact/HYaWUBfdgfJkPPyNUEpZvQ, version 1794581028-3407), with no change in behavior.
Branch: `feat/design-system`, from `feat/increment-1-capability-map` at `5070756` (the web interface of maps lives there). Delivery: work-unit commits; merge is the user's decision.
Test runner: `npm test`, `npm run typecheck`, `npm run build --workspace @potencializador/web`.

## Specs

S1. User: "traelo a la aplicación". The tokens (`project/tokens.css`) and component styles (`project/components/bundle.css`) of the artifact are copied into `apps/web/src/design-system/` unchanged, except where noted; the application's own styles use only those tokens.

S2. No behavior changes. Every existing test passes without changing what it asserts; texts, roles and labels stay as they are.

S3. Light and dark. The artifact's dark theme is selected with `data-theme="dark"`; the application sets it from the person's system preference and follows changes while open.

S4. Fonts. Archivo and Raleway, as the artifact names them. Assumption: served with the application from npm packages (`@fontsource/*`), not from Google Fonts, so people's browsers make no third-party request and the page works without that service.

S5. Brand book rules that change markup, from the artifact's README:
- "One `accent` button per screen": the main action of each screen uses the primary button.
- Map states "always pair a word with color": Borrador, Publicado, Archivado as badges.
- "Published: ... a `ds-notice--frozen` line explains why."
- Difficulty "with three squares and its word".
- "Every interactive element is at least 44px tall" and "Keyboard focus: `shadow-focus`".
- The marker "at most once per screen".

## Tasks

- [x] T1 — Tokens, fonts, theme selection, component styles and markup classes. Specs: S1–S5. Route: inline. Risk: item 5 (two new dependencies). Commit: `feat: apply the design system to the web interface` (see L3).

Route evidence: one understood change across the web styles and components; no parallel units.

## Log

L1 (2026-11-13, user, original request): "traelo a la aplicación"

L2 (2026-11-13, context): the request answers "¿Quieres afinarlo primero en Claude, o lo traigo ya a la aplicación?". The artifact was read again before starting: its `lastChange` is still the first publish, so no one edited it in the page.

L3 (2026-11-13, T1 evidence and decisions): theme selection RED observed (`theme.ts` missing), then GREEN. `npm test` 159 passed in 17 files with no existing assertion changed; one assertion added for the frozen notice. `npm run typecheck` clean; `npm run build` emits the fonts as files of the application and no reference to Google Fonts.
- `apps/web/src/design-system/tokens.css` is the artifact's file unchanged; `components.css` is its `bundle.css` without the Google Fonts import (header says so). `styles.css` was rewritten on the tokens: native buttons, inputs, tables and tabs take the system's look, so the components kept their markup.
- Markup that changed, from the brand book: primary (amber) buttons for "Crear rol", "Invitar" and "Publicar"/"Confirmar publicación"; "Descartar borrador" and "Quitar" as danger; version states as `ds-badge`; difficulty with three squares and its word; a frozen notice on published and archived versions; the top bar name as the marker.
- Fonts from `@fontsource/archivo` and `@fontsource/raleway` 5.3.0 (published 2026-07-19).
- Real browser check (local stack, example map published): dark theme applied from the system preference, Raleway loaded, map editor readable in both themes. Fixed on the way: a heading after a list inside a panel had no space above it.
- Not done: the Board component of the artifact; the board arrives with increment 2.
