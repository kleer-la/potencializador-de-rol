import { canAdministerOrganization, canCreateOrganization } from '@potencializador/domain';
import { useEffect, useState } from 'react';
import { api, type CurrentPerson, type Organization } from '../api/client.ts';
import { CreateOrganizationForm } from '../components/CreateOrganizationForm.tsx';
import { OrganizationList } from '../components/OrganizationList.tsx';
import { messages } from '../copy.ts';
import { MembersSection } from './MembersSection.tsx';

type Props = { me: CurrentPerson };

/**
 * Organizations the person can see and, for the selected one, its people. What is offered
 * follows the same domain policy the API enforces; the API remains the authority.
 */
export function OrganizationsPage({ me }: Props) {
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    api
      .organizations()
      .then((loaded) => current && setOrganizations(loaded))
      .catch(() => current && setLoadFailed(true));
    return () => {
      current = false;
    };
  }, []);

  const create = async (name: string) => {
    setCreateError(null);
    try {
      const created = await api.createOrganization(name);
      setOrganizations(await api.organizations());
      setSelectedId(created.id);
    } catch (error) {
      setCreateError(messages.requestFailed);
      throw error;
    }
  };

  if (loadFailed) return <p role="alert">{messages.requestFailed}</p>;
  if (organizations === null) return <p>{messages.loading}</p>;

  const selected = organizations.find((organization) => organization.id === selectedId) ?? null;
  return (
    <div className="columns">
      <section className="panel">
        <h2>Organizaciones</h2>
        <OrganizationList organizations={organizations} selectedId={selectedId} onSelect={setSelectedId} />
        {canCreateOrganization(me) && (
          <>
            <h3>Nueva organización</h3>
            <CreateOrganizationForm onCreate={create} error={createError} />
          </>
        )}
      </section>
      {selected !== null && (
        <section className="panel">
          <h2>Personas de {selected.name}</h2>
          {canAdministerOrganization(me, selected.id) ? (
            <MembersSection organization={selected} />
          ) : (
            <p>{messages.notAdministrator}</p>
          )}
        </section>
      )}
    </div>
  );
}
