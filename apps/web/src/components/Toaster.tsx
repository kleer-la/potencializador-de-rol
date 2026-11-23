import { useEffect, useState } from 'react';
import { notify, subscribe, type Notice } from '../feedback.ts';

const VISIBLE_MS = 5000;

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** The visible name of a field: its label's own text, without the text of the control inside it. */
function fieldName(field: Field): string | null {
  const label = field.labels?.[0];
  const own = label
    ? Array.from(label.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .trim()
    : '';
  return own || field.getAttribute('aria-label') || null;
}

function invalidText(field: Field): string {
  const name = fieldName(field);
  if (name === null) return 'Completa los campos obligatorios.';
  return field.validity.valueMissing ? `Completa el campo «${name}».` : `Revisa el campo «${name}».`;
}

/**
 * Shows the floating notices: green for a creation, red for a field the browser rejects.
 * Listens to `invalid` for the whole document, so every form gets the red notice without wiring.
 */
export function Toaster() {
  const [notices, setNotices] = useState<Notice[]>([]);

  const dismiss = (id: number) => setNotices((current) => current.filter((notice) => notice.id !== id));

  useEffect(
    () =>
      subscribe((notice) => {
        setNotices((current) => [...current, notice]);
        setTimeout(() => dismiss(notice.id), VISIBLE_MS);
      }),
    [],
  );

  useEffect(() => {
    // One submit fires `invalid` for every rejected field, all in the same task: announce only the first.
    let announced = false;
    const onInvalid = (event: Event) => {
      if (announced) return;
      announced = true;
      setTimeout(() => {
        announced = false;
      });
      notify('error', invalidText(event.target as Field));
    };
    document.addEventListener('invalid', onInvalid, true);
    return () => document.removeEventListener('invalid', onInvalid, true);
  }, []);

  return (
    <div className="toaster">
      {notices.map((notice) => (
        <div key={notice.id} role={notice.kind === 'success' ? 'status' : 'alert'} className={`toast toast--${notice.kind}`}>
          <span aria-hidden="true" className="toast-icon">
            {notice.kind === 'success' ? '✓' : '!'}
          </span>
          <span>{notice.text}</span>
          <button type="button" className="toast-close" aria-label="Cerrar aviso" onClick={() => dismiss(notice.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
