// Rules of the capability map: its life cycle and what it accepts in each state.
// Conceptual base: sections 5.1 (invariant 10), 6.1 and 6.3.

export const MAP_STATUSES = ['draft', 'published', 'archived'] as const;
export type MapStatus = (typeof MAP_STATUSES)[number];

export const DIMENSION_KINDS = ['work_cycle', 'transversal'] as const;
export type DimensionKind = (typeof DIMENSION_KINDS)[number];

export const DIFFICULTIES = ['low', 'medium', 'high'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

/**
 * Every kind of change to the content of a map. "Change" of a capability includes its
 * tools and strategic objectives; "change" of a dimension includes reordering.
 */
export const MAP_CHANGES = [
  'add_dimension',
  'add_capability',
  'change_dimension',
  'remove_dimension',
  'change_capability',
  'remove_capability',
  'change_scale',
  'change_bonus_rules',
] as const;
export type MapChange = (typeof MAP_CHANGES)[number];

/** The only growth a published map admits (invariant 10). */
const GROWTH: ReadonlySet<MapChange> = new Set(['add_dimension', 'add_capability']);

/**
 * Invariant 10: a published map only grows. A draft accepts everything; an archived map
 * accepts nothing.
 */
export function canApplyChange(status: MapStatus, change: MapChange): boolean {
  if (status === 'draft') return true;
  if (status === 'published') return GROWTH.has(change);
  return false;
}

/** draft → published → archived, and no other transition. */
export function canTransition(from: MapStatus, to: MapStatus): boolean {
  return (from === 'draft' && to === 'published') || (from === 'published' && to === 'archived');
}

/** A new version is a draft copy of a version that was already frozen. */
export function canStartNewVersionFrom(status: MapStatus): boolean {
  return status === 'published' || status === 'archived';
}

/** The shape of a map, reduced to what publishing checks. */
export type MapOutline = {
  levelCount: number;
  dimensions: readonly { name: string; capabilityCount: number }[];
};

export type PublishObstacle =
  | { kind: 'no_levels' }
  | { kind: 'no_dimensions' }
  | { kind: 'dimension_without_capabilities'; dimension: string };

/**
 * What stops a draft from being published; empty when nothing does. A board places each
 * capability in a level, so a map without levels, without dimensions, or with an empty
 * dimension cannot be used by a program.
 */
export function publishObstacles(outline: MapOutline): PublishObstacle[] {
  const obstacles: PublishObstacle[] = [];
  if (outline.levelCount === 0) obstacles.push({ kind: 'no_levels' });
  if (outline.dimensions.length === 0) obstacles.push({ kind: 'no_dimensions' });
  for (const dimension of outline.dimensions) {
    if (dimension.capabilityCount === 0) {
      obstacles.push({ kind: 'dimension_without_capabilities', dimension: dimension.name });
    }
  }
  return obstacles;
}
