// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { notifyCreated } from '../feedback.ts';
import { Toaster } from './Toaster.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function RequiredForm() {
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <label>
        Inicio
        <input type="date" required />
      </label>
      <label>
        Fin
        <input type="date" required />
      </label>
      <button type="submit">Crear ciclo</button>
    </form>
  );
}

describe('floating notices', () => {
  it('announces a creation in a success notice', () => {
    render(<Toaster />);
    act(() => notifyCreated('Ciclo creado.'));

    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('Ciclo creado.');
    expect(notice.className).toContain('toast--success');
  });

  it('closes a notice by itself after a few seconds', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => notifyCreated('Ciclo creado.'));

    act(() => vi.advanceTimersByTime(6000));

    expect(screen.queryByText('Ciclo creado.')).toBeNull();
  });

  it('closes a notice with its button', async () => {
    const user = userEvent.setup();
    render(<Toaster />);
    act(() => notifyCreated('Ciclo creado.'));

    await user.click(screen.getByRole('button', { name: 'Cerrar aviso' }));

    expect(screen.queryByText('Ciclo creado.')).toBeNull();
  });

  it('names the first missing field in one error notice', async () => {
    const user = userEvent.setup();
    render(
      <>
        <Toaster />
        <RequiredForm />
      </>,
    );

    await user.click(screen.getByRole('button', { name: 'Crear ciclo' }));

    const notices = screen.getAllByRole('alert');
    expect(notices).toHaveLength(1);
    expect(notices[0]?.textContent).toContain('Completa el campo «Inicio».');
    expect(notices[0]?.className).toContain('toast--error');
  });
});
