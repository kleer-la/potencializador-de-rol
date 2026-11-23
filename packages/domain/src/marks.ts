// Marks on the capabilities of a board (user request of 2026-11-23): tags that say what the
// owner and their panel intend to work on. The catalog grows by adding an entry here, to the
// CHECK of the `placement_marks` table and to the web labels.

import { takesPartIn, type BoardAccess } from './program.ts';

/** `candidate`: to work on in the short or medium term. `wip`: being worked on now. */
export const BOARD_MARKS = ['candidate', 'wip'] as const;
export type BoardMark = (typeof BOARD_MARKS)[number];

/** The owner and their panel mark; a program leader who only reads the board does not. */
export function canMarkCapability(personId: string, board: BoardAccess): boolean {
  return takesPartIn(personId, board);
}

/**
 * Work in progress follows the experiments: on while one on the capability is in progress,
 * never put or taken off by hand (user requests of 2026-11-23). Other marks are put by hand.
 */
export function isMarkedByHand(mark: BoardMark): boolean {
  return mark !== 'wip';
}
