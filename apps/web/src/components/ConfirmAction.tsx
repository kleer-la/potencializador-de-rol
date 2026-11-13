import { useState } from 'react';

type Props = {
  label: string;
  /** Question shown before acting. */
  prompt: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
};

/** A button that asks inside the page before acting; browser dialogs are not used. */
export function ConfirmAction({ label, prompt, confirmLabel, onConfirm }: Props) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm">
      <span>{prompt}</span>
      <button
        type="button"
        onClick={async () => {
          setAsking(false);
          await onConfirm();
        }}
      >
        {confirmLabel}
      </button>
      <button type="button" className="secondary" onClick={() => setAsking(false)}>
        Cancelar
      </button>
    </span>
  );
}
