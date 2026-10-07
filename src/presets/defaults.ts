import type { DocType, Rect } from '../types';

export interface DocTypeInfo {
  type: DocType;
  title: string;
  short: string;
  description: string;
}

export const DOC_TYPES: DocTypeInfo[] = [
  { type: 'notes', short: 'Notes', title: 'Paper notes', description: 'Patient sticker in the top-right corner' },
  { type: 'optos1', short: 'Optos 1', title: 'Optos (single)', description: 'One image; overlay top-left, toolbar on top' },
  { type: 'optos2', short: 'Optos 2', title: 'Optos (pair)', description: 'Two images side by side; overlay on each, toolbar on top' },
  { type: 'cirrus', short: 'Cirrus', title: 'Cirrus OCT', description: 'Identifiers in the report header' },
  { type: 'generic', short: 'Other', title: 'Other (EMR, letter)', description: 'No preset; text scan and manual boxes only' },
];

/**
 * Best-guess starting positions, normalised to the straightened image.
 * Users adjust these on a real image and save their own template.
 */
export const DEFAULT_PRESETS: Record<DocType, Rect[]> = {
  notes: [{ x: 0.55, y: 0, w: 0.45, h: 0.22 }],
  optos1: [
    { x: 0, y: 0, w: 1, h: 0.08 },
    { x: 0, y: 0.08, w: 0.35, h: 0.14 },
  ],
  optos2: [
    { x: 0, y: 0, w: 1, h: 0.08 },
    { x: 0, y: 0.08, w: 0.24, h: 0.14 },
    { x: 0.5, y: 0.08, w: 0.24, h: 0.14 },
  ],
  // Name, ID, DOB and technician fields; exam date, scan type and signal strength stay visible.
  cirrus: [
    { x: 0.02, y: 0.015, w: 0.3, h: 0.035 },
    { x: 0.02, y: 0.05, w: 0.3, h: 0.035 },
    { x: 0.02, y: 0.085, w: 0.3, h: 0.035 },
    { x: 0.36, y: 0.085, w: 0.28, h: 0.035 },
  ],
  generic: [],
};
