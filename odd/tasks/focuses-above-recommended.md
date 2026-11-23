# Focuses above the recommended number

Objective: a planned cycle may take more focuses than the program's number; from that number on, creating a focus shows a warning instead of being refused.
Branch: `feat/focuses-above-recommended`, from `main` at `d705224`. Delivery: one work-unit commit; merge, push and deploy are the user's decisions.
Test runner: `npm test` (Vitest; project `api` needs Docker), `npm run typecheck`.

## Specs

S1. User's request (backlog, docs/Backlog.md): "En los ciclos de mejora nuevos, permitir más de 3 focos. A partir del 4to foco, en el momento de crearlos, hacer un aviso tipo advertencia: ¡Pilas con tu foco, no agreguemos más de lo que podamos atender!"

S2. User decision (2026-11-23): "la primera, que el máximo sea recomendado" — the program's maximum of focuses per cycle becomes a recommended number; the warning appears when creating any focus above it (from the 4th with the default of 3).

S3. Rules (assumptions derived from S1 and S2, not stated by the user):
- Neither the database nor the API refuses a focus, nor the start of a cycle, for being above the recommended number. `too_many_focuses` and the `tooMany` start blocker disappear.
- While the cycle is planned, "Nuevo foco" stays available above the number. When the cycle already holds the recommended number or more, the form shows the warning "¡Pilas con tu foco, no agreguemos más de lo que podamos atender!".
- The cycle shows "Focos: N · recomendados: M"; the program form labels the field "Focos recomendados por ciclo" and the program list says "M focos recomendados por ciclo". The column `max_focuses` and the API field `maxFocuses` keep their names.

## Tasks

- [x] T1 — Migration 0016 (focus guard and cycle start without the cap), domain, API, web form and display, conceptual base, tests. Specs: S1-S3. Route: inline (one small behavior; no writer reason). Risk: item 3 (the `cannot_start` response drops `tooMany`; its only consumer is the web app, changed together). Commit: the one that adds this document (see Log L4).

## Log

L1 (2026-11-23, user): "En los ciclos de mejora nuevos, permitir más de 3 focos. A partir del 4to foco, en el momento de crearlos, hacer un aviso tipo advertencia: ¡Pilas con tu foco, no agreguemos más de lo que podamos atender!"

L2 (2026-11-23, user): "la primera, que el máximo sea recomendado"

L3 (2026-11-23): RED observed in domain, web cycle and program form tests. GREEN: migration 0016 replaces `guard_focus` and `app_start_cycle` without the cap; storage test now takes a third focus above the recommended two and starts the cycle with it. `npm run typecheck` clean, `npm test` 46 files / 445 tests passed. Conceptual base updated (Program attributes, invariant 8, program creation step).

L4 (2026-11-23, user): "funciona, haz commit" — verified on the local stack after migration 0016; committed as one work unit.
