import type { Organization } from '../api/client.ts';
import { messages } from '../copy.ts';

type Props = {
  organizations: Organization[];
  selectedId: string | null;
  onSelect: (organizationId: string) => void;
};

export function OrganizationList({ organizations, selectedId, onSelect }: Props) {
  if (organizations.length === 0) return <p>{messages.noOrganizations}</p>;
  return (
    <ul className="plain-list">
      {organizations.map((organization) => (
        <li key={organization.id}>
          <button
            type="button"
            className="link-button"
            aria-pressed={organization.id === selectedId}
            onClick={() => onSelect(organization.id)}
          >
            {organization.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
