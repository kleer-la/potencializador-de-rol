import { useState } from 'react';

type Props = {
  label: string;
  /** Question shown before acting. */
  prompt: string;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  /** `primary`: the main action of the screen. `danger`: it destroys something. */
  variant?: 'primary' | 'danger' | 'quiet-danger';
};

const triggerClass = { primary: 'primary', danger: 'danger', 'quiet-danger': 'secondary danger' } as const;

/** A button that asks inside the page before acting; browser dialogs are not used. */
export function ConfirmAction({ label, prompt, confirmLabel, onConfirm, variant }: Props) {
  const [asking, setAsking] = useState(false);

  if (!asking) {
    return (
      <button type="button" className={variant && triggerClass[variant]} onClick={() => setAsking(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="confirm">
      <span>{prompt}</span>
      <button
        type="button"
        className={variant === 'primary' ? 'primary' : variant ? 'danger' : undefined}
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
