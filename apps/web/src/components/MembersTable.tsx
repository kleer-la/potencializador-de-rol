import type { Member } from '../api/client.ts';
import { messages, roleLabels } from '../copy.ts';

type Props = {
  organizationName: string;
  members: Member[];
};

export function MembersTable({ organizationName, members }: Props) {
  return (
    <table aria-label={`Personas de ${organizationName}`}>
      <thead>
        <tr>
          <th scope="col">Nombre</th>
          <th scope="col">Correo</th>
          <th scope="col">Roles</th>
        </tr>
      </thead>
      <tbody>
        {members.map((member) => (
          <tr key={member.personId}>
            <td>{member.name}</td>
            <td>{member.email}</td>
            <td>
              {member.roles.length === 0
                ? messages.noRoles
                : member.roles.map((role) => roleLabels[role]).join(', ')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
