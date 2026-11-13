// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Board } from '../api/client.ts';
import { fakeBackend, json } from '../test-support/fake-backend.ts';
import { BoardsPage } from './BoardsPage.tsx';

const summary = {
  id: 'board-1',
  organizationId: 'org-a',
  organizationName: 'Universidad A',
  programId: 'program-1',
  programName: 'Product Owners 2027',
  ownerName: 'Ana Gómez',
  status: 'not_started' as const,
  panelRoles: [],
};

const board = (viewer: Board['viewer']): Board => ({
  id: 'board-1',
  organizationId: 'org-a',
  program: { id: 'program-1', name: 'Product Owners 2027' },
  ownerName: 'Ana Gómez',
  status: 'not_started',
  hasBaseline: false,
  viewer,
  levels: [
    { id: 'level-0', position: 0, name: 'No sabe', multiplier: 0, requiresTransfer: false },
    { id: 'level-1', position: 1, name: 'Principiante', multiplier: 1, requiresTransfer: false },
  ],
  dimensions: [
    { id: 'dimension-1', name: 'Entender', kind: 'work_cycle', position: 0 },
    { id: 'dimension-2', name: 'Comunicación', kind: 'transversal', position: 1 },
  ],
  capabilities: [
    { id: 'capability-1', dimensionId: 'dimension-1', statement: 'Identifica a quién sirve el producto', difficulty: 'medium', position: 0 },
    { id: 'capability-2', dimensionId: 'dimension-1', statement: 'Lee el estado actual del producto', difficulty: null, position: 1 },
    { id: 'capability-3', dimensionId: 'dimension-2', statement: 'Comunica por escrito de forma clara', difficulty: 'low', position: 0 },
  ],
  placements: [
    { capabilityId: 'capability-1', levelId: null, addedAt: '2026-11-13T10:00:00Z' },
    { capabilityId: 'capability-3', levelId: 'level-1', addedAt: '2026-11-13T10:00:00Z' },
  ],
});

const owner = { isOwner: true, panelRoles: [], canAdd: false, canRemove: false };
const leader = { isOwner: false, panelRoles: ['leader' as const], canAdd: true, canRemove: true };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Mis tableros', () => {
  it('lists the boards the person owns and those they accompany', async () => {
    fakeBackend({
      'GET /api/boards': () =>
        json({ mine: [summary], accompanied: [{ ...summary, id: 'board-2', ownerName: 'Luis Mora', panelRoles: ['mentor'] }] }),
    });

    render(<BoardsPage />);

    const mine = await screen.findByRole('region', { name: 'Mis tableros' });
    const accompanied = screen.getByRole('region', { name: 'Tableros que acompaño' });
    expect(within(mine).getByText('Product Owners 2027')).toBeTruthy();
    expect(within(mine).getByText('Sin iniciar')).toBeTruthy();
    expect(within(accompanied).getByText('Luis Mora')).toBeTruthy();
    expect(within(accompanied).getByText('Mentor')).toBeTruthy();
  });

  it('recovers after a failed load when the person comes back', async () => {
    let fail = true;
    fakeBackend({
      'GET /api/boards': () => (fail ? json({ error: 'unavailable' }, 503) : json({ mine: [summary], accompanied: [] })),
      'GET /api/boards/board-1': () => json(board(owner)),
    });
    const user = userEvent.setup();

    render(<BoardsPage />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    fail = false;
    await user.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(await screen.findByRole('region', { name: 'Mis tableros' })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when the person has no board yet', async () => {
    fakeBackend({ 'GET /api/boards': () => json({ mine: [], accompanied: [] }) });

    render(<BoardsPage />);

    expect(await screen.findByText('Todavía no tienes tableros. Aparecen cuando te inscriben en un programa.')).toBeTruthy();
  });
});

describe('the board', () => {
  const open = async (viewer: Board['viewer'], extra = {}) => {
    const calls = fakeBackend({
      'GET /api/boards': () => json({ mine: [summary], accompanied: [] }),
      'GET /api/boards/board-1': () => json(board(viewer)),
      ...extra,
    });
    const user = userEvent.setup();
    render(<BoardsPage />);
    await user.click(await screen.findByRole('button', { name: 'Abrir el tablero de Ana Gómez' }));
    await screen.findByRole('heading', { name: 'Tablero de Ana Gómez' });
    return { calls, user };
  };

  it('shows each capability of the board in its column, by dimension, with "Sin ubicar" first', async () => {
    await open(owner);

    const kanban = screen.getByRole('table', { name: 'Tablero' });
    const headers = within(kanban).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual(['Capacidad', 'Sin ubicar', '0 · No sabe', '1 · Principiante']);
    const first = within(kanban).getByRole('row', { name: /Identifica a quién sirve el producto/ });
    expect(within(first).getAllByRole('cell')[1]!.textContent).toContain('●');
    const third = within(kanban).getByRole('row', { name: /Comunica por escrito/ });
    expect(within(third).getAllByRole('cell')[3]!.textContent).toContain('●');
    expect(within(kanban).queryByText('Lee el estado actual del producto')).toBeNull();
    expect(within(kanban).getByRole('rowheader', { name: 'Entender' })).toBeTruthy();
  });

  it('offers no change to the owner', async () => {
    await open(owner);

    expect(screen.queryByRole('button', { name: /Agregar|Quitar/ })).toBeNull();
    expect(screen.getByText('Tu panel decide qué capacidades trabajas en este programa.')).toBeTruthy();
  });

  it('lets a panel member add a capability of the map and remove one from the board', async () => {
    const { calls, user } = await open(leader, {
      'POST /api/boards/board-1/capabilities': () => json({ capabilityId: 'capability-2' }, 201),
      'DELETE /api/boards/board-1/capabilities/capability-3': () => ({ status: 204 }),
    });

    await user.click(screen.getByRole('button', { name: 'Agregar «Lee el estado actual del producto»' }));
    await user.click(screen.getByRole('button', { name: 'Quitar «Comunica por escrito de forma clara»' }));
    await user.click(screen.getByRole('button', { name: 'Confirmar' }));

    expect(calls.find((call) => call.route === 'POST /api/boards/board-1/capabilities')?.body).toEqual({
      capabilityId: 'capability-2',
    });
    expect(calls.some((call) => call.route === 'DELETE /api/boards/board-1/capabilities/capability-3')).toBe(true);
  });
});
