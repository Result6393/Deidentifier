export type DocType = 'notes' | 'optos1' | 'optos2' | 'cirrus' | 'generic';

/** A point in normalised (0..1) or pixel space, depending on context. */
export interface Pt {
  x: number;
  y: number;
}

/** A rectangle in normalised coordinates (0..1) of the straightened image. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BoxSource = 'preset' | 'manual' | 'ocr' | 'barcode';
export type BoxStatus = 'accepted' | 'suggested';

export interface Box extends Rect {
  id: string;
  source: BoxSource;
  status: BoxStatus;
  reason?: string;
  /** Replacement text printed on the redaction box, e.g. "RE" or "67M". */
  stamp?: string;
}

/** Pixel-space bounding box as returned by OCR. */
export interface BBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrWord {
  text: string;
  bbox: BBox;
}

export interface OcrLine {
  words: OcrWord[];
}

export interface Hit {
  bbox: BBox;
  reason: string;
  status: BoxStatus;
}

export interface SearchTerms {
  patient: string[];
  clinician: string[];
}
