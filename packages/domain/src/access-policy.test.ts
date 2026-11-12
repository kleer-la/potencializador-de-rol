import { describe, expect, it } from 'vitest';
import {
  canAdministerOrganization,
  canCreateOrganization,
  canDesignMaps,
  canReadOrganization,
  type Actor,
} from './access-policy.ts';

const superAdministrator: Actor = { isSuperAdmin: true, memberships: [] };
const administratorOfA: Actor = {
  isSuperAdmin: false,
  memberships: [{ organizationId: 'A', role: 'administrator' }],
};
const designerOfA: Actor = {
  isSuperAdmin: false,
  memberships: [{ organizationId: 'A', role: 'map_designer' }],
};

describe('who creates organizations', () => {
  it('only a super administrator', () => {
    expect(canCreateOrganization(superAdministrator)).toBe(true);
    expect(canCreateOrganization(administratorOfA)).toBe(false);
    expect(canCreateOrganization(designerOfA)).toBe(false);
  });
});

describe('who administers an organization', () => {
  it('a super administrator administers any organization', () => {
    expect(canAdministerOrganization(superAdministrator, 'A')).toBe(true);
    expect(canAdministerOrganization(superAdministrator, 'B')).toBe(true);
  });

  it('INV-11 an administrator administers only the organization of the membership', () => {
    expect(canAdministerOrganization(administratorOfA, 'A')).toBe(true);
    expect(canAdministerOrganization(administratorOfA, 'B')).toBe(false);
  });

  it('a map designer does not administer the organization', () => {
    expect(canAdministerOrganization(designerOfA, 'A')).toBe(false);
  });
});

describe('who designs the maps of an organization', () => {
  it('a map designer of that organization and a super administrator', () => {
    expect(canDesignMaps(designerOfA, 'A')).toBe(true);
    expect(canDesignMaps(superAdministrator, 'A')).toBe(true);
  });

  it('INV-11 not a map designer of another organization', () => {
    expect(canDesignMaps(designerOfA, 'B')).toBe(false);
  });

  it('not an administrator who is not also map designer', () => {
    expect(canDesignMaps(administratorOfA, 'A')).toBe(false);
  });
});

describe('who reads what an organization defines', () => {
  it('any member of it and a super administrator', () => {
    expect(canReadOrganization(administratorOfA, 'A')).toBe(true);
    expect(canReadOrganization(designerOfA, 'A')).toBe(true);
    expect(canReadOrganization(superAdministrator, 'B')).toBe(true);
  });

  it('INV-11 nobody from another organization', () => {
    expect(canReadOrganization(administratorOfA, 'B')).toBe(false);
    expect(canReadOrganization({ isSuperAdmin: false, memberships: [] }, 'A')).toBe(false);
  });
});
