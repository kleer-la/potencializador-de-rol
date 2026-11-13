// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { SearchPicker } from './SearchPicker.tsx';

const tools = [
  { id: 't1', name: 'Gestión de riesgos' },
  { id: 't2', name: 'Gestión de stakeholders' },
  { id: 't3', name: 'Jobs To Be Done' },
  ...Array.from({ length: 12 }, (_, index) => ({ id: `m${index}`, name: `Métrica ${index}` })),
];

function Harness({ initial = [] as string[] }) {
  const [selected, setSelected] = useState(initial);
  return (
    <>
      <SearchPicker legend="Herramientas" options={tools} selected={selected} onChange={setSelected} />
      <output>{selected.join(',')}</output>
    </>
  );
}

afterEach(cleanup);

describe('SearchPicker', () => {
  it('finds options by part of their name, ignoring case and accents', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText('Buscar herramientas'), 'GESTION');

    expect(screen.getByRole('button', { name: 'Agregar «Gestión de riesgos»' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Agregar «Gestión de stakeholders»' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Agregar «Jobs To Be Done»' })).toBeNull();
  });

  it('adds an option as a tag, clears the search, and removes it again', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const search = screen.getByLabelText('Buscar herramientas') as HTMLInputElement;

    await user.type(search, 'jobs');
    await user.click(screen.getByRole('button', { name: 'Agregar «Jobs To Be Done»' }));

    expect(screen.getByRole('status').textContent).toBe('t3');
    expect(search.value).toBe('');
    const chosen = screen.getByRole('list', { name: 'Herramientas elegidas' });
    expect(within(chosen).getByText('Jobs To Be Done')).toBeTruthy();
    await user.click(within(chosen).getByRole('button', { name: 'Quitar «Jobs To Be Done»' }));
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('shows at most eight matches, leaves out the chosen ones, and says when nothing matches', async () => {
    const user = userEvent.setup();
    render(<Harness initial={['m0']} />);
    const search = screen.getByLabelText('Buscar herramientas');

    await user.type(search, 'metrica');
    const matches = screen.getAllByRole('button', { name: /^Agregar «Métrica/ });
    await user.clear(search);
    await user.type(search, 'zzz');

    expect(matches).toHaveLength(8);
    expect(matches.map((button) => button.getAttribute('aria-label'))).not.toContain('Agregar «Métrica 0»');
    expect(screen.getByText('Sin resultados.')).toBeTruthy();
  });

  it('adds the first match on Enter instead of submitting the surrounding form', async () => {
    const user = userEvent.setup();
    let submitted = 0;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted += 1;
        }}
      >
        <Harness />
      </form>,
    );

    await user.type(screen.getByLabelText('Buscar herramientas'), 'stake{Enter}');
    await user.type(screen.getByLabelText('Buscar herramientas'), 'zzz{Enter}');

    expect(screen.getByRole('status').textContent).toBe('t2');
    expect(submitted).toBe(0);
  });

  it('ignores the Enter that confirms an input method composition', () => {
    render(<Harness />);
    const search = screen.getByLabelText('Buscar herramientas');

    fireEvent.change(search, { target: { value: 'jobs' } });
    fireEvent.keyDown(search, { key: 'Enter', isComposing: true });

    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('lists nothing before typing, and tells how many options there are', () => {
    render(<Harness />);

    expect(screen.queryByRole('button', { name: /^Agregar/ })).toBeNull();
    expect(screen.getByText('Escribe para buscar entre 15.')).toBeTruthy();
  });
});
