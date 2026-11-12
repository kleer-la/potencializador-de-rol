import { describe, expect, it } from 'vitest';
import {
  MAP_CHANGES,
  canApplyChange,
  canStartNewVersionFrom,
  canTransition,
  publishObstacles,
  type MapChange,
} from './capability-map.ts';

const GROWTH: MapChange[] = ['add_dimension', 'add_capability'];

describe('map life cycle', () => {
  it('goes draft → published → archived and nowhere else', () => {
    expect(canTransition('draft', 'published')).toBe(true);
    expect(canTransition('published', 'archived')).toBe(true);

    expect(canTransition('draft', 'archived')).toBe(false);
    expect(canTransition('published', 'draft')).toBe(false);
    expect(canTransition('archived', 'published')).toBe(false);
    expect(canTransition('archived', 'draft')).toBe(false);
    expect(canTransition('draft', 'draft')).toBe(false);
  });

  it('starts a new version only from a published or archived one', () => {
    expect(canStartNewVersionFrom('published')).toBe(true);
    expect(canStartNewVersionFrom('archived')).toBe(true);
    expect(canStartNewVersionFrom('draft')).toBe(false);
  });
});

describe('what a map accepts in each state', () => {
  it('a draft accepts every change', () => {
    for (const change of MAP_CHANGES) {
      expect(canApplyChange('draft', change), change).toBe(true);
    }
  });

  it('INV-10 a published map accepts new dimensions and new capabilities', () => {
    for (const change of GROWTH) {
      expect(canApplyChange('published', change), change).toBe(true);
    }
  });

  it('INV-10 a published map refuses every change or removal of what exists', () => {
    const refused = MAP_CHANGES.filter((change) => !GROWTH.includes(change));

    expect(refused).toEqual([
      'change_dimension',
      'remove_dimension',
      'change_capability',
      'remove_capability',
      'change_scale',
      'change_bonus_rules',
    ]);
    for (const change of refused) {
      expect(canApplyChange('published', change), change).toBe(false);
    }
  });

  it('an archived map accepts nothing, not even growth', () => {
    for (const change of MAP_CHANGES) {
      expect(canApplyChange('archived', change), change).toBe(false);
    }
  });
});

describe('what a map needs to be published', () => {
  const complete = {
    levelCount: 5,
    dimensions: [
      { name: 'Entender', capabilityCount: 7 },
      { name: 'Comunicación', capabilityCount: 6 },
    ],
  };

  it('a map with levels and capabilities in every dimension has no obstacle', () => {
    expect(publishObstacles(complete)).toEqual([]);
  });

  it('names a missing scale and missing dimensions', () => {
    expect(publishObstacles({ levelCount: 0, dimensions: [] })).toEqual([
      { kind: 'no_levels' },
      { kind: 'no_dimensions' },
    ]);
  });

  it('names every dimension without capabilities', () => {
    const obstacles = publishObstacles({
      levelCount: 1,
      dimensions: [
        { name: 'Entender', capabilityCount: 0 },
        { name: 'Descubrir', capabilityCount: 2 },
        { name: 'Liderazgo', capabilityCount: 0 },
      ],
    });

    expect(obstacles).toEqual([
      { kind: 'dimension_without_capabilities', dimension: 'Entender' },
      { kind: 'dimension_without_capabilities', dimension: 'Liderazgo' },
    ]);
  });
});
