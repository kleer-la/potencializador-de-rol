import { MEMBERSHIP_ROLES, type MembershipRole } from '@potencializador/domain';
import { useState, type FormEvent } from 'react';
import type { Invitation } from '../api/client.ts';
import { roleLabels } from '../copy.ts';

type Props = {
  /** Resolves when the person was invited; rejects otherwise. */
  onInvite: (invitation: Invitation) => Promise<void>;
  error: string | null;
};

export function InviteMemberForm({ onInvite, error }: Props) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  // '' invites without an organization role: participants and panel members of programs.
  const [role, setRole] = useState<MembershipRole | ''>('administrator');
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onInvite(role === '' ? { email, name } : { email, name, role });
      setEmail('');
      setName('');
    } catch {
      // The container reports the failure through `error`; what was typed stays.
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="inline-form" onSubmit={submit}>
      <label>
        Correo
        <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
      </label>
      <label>
        Nombre
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
      </label>
      <label>
        Rol
        <select value={role} onChange={(event) => setRole(event.target.value as MembershipRole | '')}>
          {MEMBERSHIP_ROLES.map((option) => (
            <option key={option} value={option}>
              {roleLabels[option]}
            </option>
          ))}
          <option value="">Sin rol en la organización</option>
        </select>
      </label>
      <button type="submit" className="primary" disabled={submitting}>
        Invitar
      </button>
      {error !== null && <p role="alert">{error}</p>}
    </form>
  );
}
