import { useState, type FormEvent } from 'react';

type Props = {
  /** Resolves when the organization was created; rejects otherwise. */
  onCreate: (name: string) => Promise<void>;
  error: string | null;
};

export function CreateOrganizationForm({ onCreate, error }: Props) {
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onCreate(name);
      setName('');
    } catch {
      // The container reports the failure through `error`; the typed name stays.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        Nombre de la organización
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
      </label>
      <button type="submit" disabled={submitting}>
        Crear organización
      </button>
      {error !== null && <p role="alert">{error}</p>}
    </form>
  );
}
