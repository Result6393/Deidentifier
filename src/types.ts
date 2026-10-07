export type DocType = 'notes' | 'optos1' | 'optos2' | 'cirrus' | 'generic';

/** A point in normalised (0..1) or pixel space, depending on context. */
export interface Pt {
  x: number;
  y: number;
}

/** A rectangle in normalised coordinates (0..1) of the image. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Box extends Rect {
  id: string;
  /** Replacement text printed on the redaction box, e.g. "RE" or "LE". */
  stamp?: string;
}
