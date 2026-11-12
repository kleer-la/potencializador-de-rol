import { useEffect, useState } from 'react';
import { ApiError, api, type Invitation, type Member, type Organization } from '../api/client.ts';
import { InviteMemberForm } from '../components/InviteMemberForm.tsx';
import { MembersTable } from '../components/MembersTable.tsx';
import { messages } from '../copy.ts';

type Props = { organization: Organization };

/** Loads and changes the people of one organization. Rendered only for who may administer it. */
export function MembersSection({ organization }: Props) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    setMembers(null);
    setLoadFailed(false);
    setInviteError(null);
    api
      .members(organization.id)
      .then((loaded) => current && setMembers(loaded))
      .catch(() => current && setLoadFailed(true));
    return () => {
      current = false;
    };
  }, [organization.id]);

  const invite = async (invitation: Invitation) => {
    setInviteError(null);
    try {
      await api.invite(organization.id, invitation);
      setMembers(await api.members(organization.id));
    } catch (error) {
      setInviteError(
        error instanceof ApiError && error.code === 'invitation_not_possible'
          ? messages.invitationNotPossible
          : messages.requestFailed,
      );
      throw error;
    }
  };

  if (loadFailed) return <p role="alert">{messages.requestFailed}</p>;
  if (members === null) return <p>{messages.loading}</p>;
  return (
    <>
      <MembersTable organizationName={organization.name} members={members} />
      <h3>Invitar a una persona</h3>
      <InviteMemberForm onInvite={invite} error={inviteError} />
    </>
  );
}
