/** A still pointer may keep a hover tip this long during an AI turn, then the tip closes. */
export const HOVER_IDLE_MS = 1200;

export interface HoverGate {
  overTile: boolean;
  pinned: boolean;
  cameraMoving: boolean;
  /** The camera has moved since the pointer last moved. */
  cameraSincePointer: boolean;
  modalOpen: boolean;
  aiTurn: boolean;
  pointerIdleMs: number;
}

/**
 * An unpinned tile tip stays up only while the pointer is on that tile and the view is still.
 * A pinned tip stays up through camera moves, modals, and AI idle.
 */
export function hoverTipOpen(gate: HoverGate): boolean {
  if (gate.pinned) return true;
  if (!gate.overTile || gate.cameraMoving || gate.cameraSincePointer || gate.modalOpen) return false;
  if (gate.aiTurn && gate.pointerIdleMs >= HOVER_IDLE_MS) return false;
  return true;
}
