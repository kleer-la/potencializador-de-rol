import { canAdministerOrganization, canDesignMaps } from '@potencializador/domain';
import { useMemo, useState } from 'react';
import { organizationApi, type CurrentPerson, type Organization } from '../api/client.ts';
import { CatalogSection } from './CatalogSection.tsx';
import { MembersSection } from './MembersSection.tsx';
import { RolesSection } from './RolesSection.tsx';

type Tab = 'people' | 'roles' | 'catalogs';
type Props = { me: CurrentPerson; organization: Organization };

/** Everything inside one organization, in tabs that follow what the person may do. */
export function OrganizationWorkspace({ me, organization }: Props) {
  const canAdminister = canAdministerOrganization(me, organization.id);
  const canDesign = canDesignMaps(me, organization.id);
  const api = useMemo(() => organizationApi(organization.id), [organization.id]);
  const [tab, setTab] = useState<Tab>(canAdminister ? 'people' : 'roles');

  const tabs: { id: Tab; label: string }[] = [
    ...(canAdminister ? [{ id: 'people' as const, label: 'Personas' }] : []),
    { id: 'roles', label: 'Roles y mapas' },
    { id: 'catalogs', label: 'Catálogos' },
  ];

  return (
    <div className="stack">
      <div role="tablist" aria-label={`Secciones de ${organization.name}`} className="tabs">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === 'people' && canAdminister && (
        <section className="panel">
          <h2>Personas de {organization.name}</h2>
          <MembersSection organization={organization} />
        </section>
      )}
      {tab === 'roles' && <RolesSection api={api} canAdminister={canAdminister} canDesign={canDesign} />}
      {tab === 'catalogs' && (
        <div className="columns">
          <CatalogSection api={api} kind="tools" title="Herramientas" canDesign={canDesign} />
          <CatalogSection api={api} kind="strategic-objectives" title="Objetivos estratégicos" canDesign={canDesign} />
        </div>
      )}
    </div>
  );
}
