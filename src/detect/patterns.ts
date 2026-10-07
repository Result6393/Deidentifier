import type { BoxStatus, SearchTerms } from '../types';

/** A character range in a line of OCR text that should be redacted. */
export interface Span {
  start: number;
  end: number;
  reason: string;
  status: BoxStatus;
}

/**
 * Maps common OCR letter/digit confusions to digits inside tokens that are
 * mostly digits ("1O23" -> "1023"). Keeps the string length unchanged so
 * character offsets stay valid.
 */
export function normaliseDigits(text: string): string {
  return text.replace(/\S+/g, (tok) => {
    const digits = (tok.match(/\d/g) ?? []).length;
    if (digits === 0 || digits / tok.length < 0.5) return tok;
    return tok.replace(/[Oo]/g, '0').replace(/[Il|]/g, '1');
  });
}

/** Australian Medicare card number check digit (first digit 2-6). */
export function isValidMedicare(digits: string): boolean {
  if (!/^[2-6]\d{9,10}$/.test(digits)) return false;
  const weights = [1, 3, 7, 9, 1, 3, 7, 9];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(digits[i]) * weights[i];
  return sum % 10 === Number(digits[8]);
}

const STATES_UPPER = 'SA|WA|NT|ACT';
const STATES_ANYCASE = 'VIC|NSW|QLD|TAS';
const STREET_TYPES =
  'St|Street|Rd|Road|Ave|Av|Avenue|Cres|Crescent|Ct|Court|Dr|Drive|Pl|Place|Pde|Parade|Hwy|Highway|' +
  'Blvd|Bvd|Boulevard|Tce|Terrace|Way|Lane|Ln|Cl|Close|Gr|Grove|Cct|Circuit|Esp|Esplanade|Sq|Square';

// Labels whose value is a patient identifier. "Loose" labels need no colon but
// their value must contain a digit; "strict" labels must be followed by ":".
const PATIENT_LOOSE =
  "medicare(?:\\s*(?:no|number|card)\\.?)?|mrn|urn|u\\.?r\\.?(?:\\s*(?:no|number)\\.?)?|" +
  'hosp(?:ital)?\\.?\\s*(?:no|number)\\.?|dob|d\\.o\\.b\\.?|ph(?:one)?|home\\s*ph|work\\s*ph|' +
  'mob(?:ile)?|tel|dva(?:\\s*no\\.?)?|ihi|pt\\s*id|patient\\s*id';
const PATIENT_STRICT =
  'name|patient(?:\\s*name)?|pt\\s*name|surname|family\\s*name|given\\s*names?|first\\s*name|' +
  'address|addr\\.?|id|born|date\\s*of\\s*birth|email|nok|next\\s*of\\s*kin|contact';
const CLINICIAN_LABELS =
  'signed|signature|optometrist|orthoptist|ophthalmologist|consultant|registrar|technician|tech|' +
  'operator|physician|doctor|referring(?:\\s*(?:doctor|practitioner|dr))?|referred\\s*by|' +
  'reviewed\\s*by|seen\\s*by|examined\\s*by|author|provider|clinician|gp|nurse|cc';

const OTHER_LABELS = 'exam\\s*date|exam\\s*time|scan\\s*date|visit\\s*date|date|time|gender|sex|age|signal\\s*strength|serial(?:\\s*(?:no|number))?|eye|laterality';

/**
 * Where a labelled value ends: the next known label, the next one-word
 * "Label:", or 60 characters, whichever comes first.
 */
function valueEnd(text: string, from: number): number {
  const known = `${PATIENT_LOOSE}|${PATIENT_STRICT}|${CLINICIAN_LABELS}|${OTHER_LABELS}`;
  const rest = text.slice(from);
  const next = rest.search(
    new RegExp(`(?<![A-Za-z])(?:(?:${known})\\s*[:#]|[A-Za-z][A-Za-z./]*\\s?:|(?:${PATIENT_LOOSE})\\s*[:#]?\\s*\\d)`, 'i'),
  );
  const end = next === -1 ? rest.length : next;
  return from + Math.min(end, 60);
}

function trimSpan(text: string, start: number, end: number): [number, number] {
  while (start < end && /\s/.test(text[start])) start++;
  while (end > start && /[\s,;]/.test(text[end - 1])) end--;
  return [start, end];
}

/** Limits how far a labelled value extends, given what that kind of value looks like. */
type Shape = (value: string) => number;

const DATE_SHAPE: Shape = (v) =>
  v.match(/^\d{1,2}\s?[/.\- ]\s?(?:\d{1,2}|[A-Za-z]{3,9})\s?[/.\- ]\s?\d{2,4}/)?.[0].length ?? v.match(/^\S+/)?.[0].length ?? 0;
const NUMBER_SHAPE: Shape = (v) => v.match(/^[A-Za-z]{0,3}[\s\-]?\(?\+?\d[\d\s\-()]*\d|^[A-Za-z]{0,3}\d/)?.[0].length ?? 0;
const words = (n: number): Shape => (v) => v.match(new RegExp(`^\\S+(?:\\s+\\S+){0,${n - 1}}`))?.[0].length ?? 0;
const REST: Shape = (v) => v.length;

const DATE_LABEL = /^(?:dob|d\.o\.b\.?|born|date\s*of\s*birth)/i;
const NAME_LABEL = /^(?:name|patient|pt\s*name|surname|family\s*name|given\s*names?|first\s*name|nok|next\s*of\s*kin)/i;
const TEXT_LABEL = /^(?:address|addr|email|contact)/i;

function shapeFor(label: string): Shape {
  if (/\bid$/i.test(label.trim())) return NUMBER_SHAPE;
  if (DATE_LABEL.test(label)) return DATE_SHAPE;
  if (NAME_LABEL.test(label)) return words(4);
  if (TEXT_LABEL.test(label)) return REST;
  return NUMBER_SHAPE;
}

function labelled(
  text: string,
  labels: string,
  colon: 'required' | 'optional',
  test: RegExp,
  reason: string,
  status: BoxStatus,
  shape?: Shape,
): Span[] {
  const sep = colon === 'required' ? '\\s*[:#]\\s*' : '\\s*[:#.]?\\s*';
  const re = new RegExp(`(?<![A-Za-z])(${labels})${sep}`, 'gi');
  const spans: Span[] = [];
  for (const m of text.matchAll(re)) {
    const from = m.index + m[0].length;
    let [start, end] = trimSpan(text, from, valueEnd(text, from));
    const len = (shape ?? shapeFor(m[1]))(text.slice(start, end));
    [start, end] = trimSpan(text, start, start + len);
    const value = text.slice(start, end);
    if (end > start && test.test(value)) spans.push({ start, end, reason, status });
  }
  return spans;
}

function regexSpans(text: string, re: RegExp, reason: string, status: BoxStatus, valid?: (m: RegExpMatchArray) => boolean): Span[] {
  const spans: Span[] = [];
  for (const m of text.matchAll(re)) {
    if (valid && !valid(m)) continue;
    spans.push({ start: m.index, end: m.index + m[0].length, reason, status });
  }
  return spans;
}

export function levenshtein(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** True when an OCR word matches a search word, tolerating one OCR error on longer words. */
export function fuzzyWordMatch(ocr: string, term: string): boolean {
  const a = ocr.toLowerCase();
  const b = term.toLowerCase();
  if (a === b) return true;
  return b.length >= 5 && levenshtein(a, b) <= 1;
}

function isNumericTerm(term: string): boolean {
  const compact = term.replace(/\s/g, '');
  const digits = (compact.match(/\d/g) ?? []).length;
  return digits >= 4 && digits / compact.length >= 0.6;
}

function termSpans(text: string, terms: string[], reason: string): Span[] {
  const spans: Span[] = [];
  const words = terms
    .filter((t) => !isNumericTerm(t))
    .flatMap((t) => t.split(/[\s,]+/))
    .map((w) => w.replace(/[^A-Za-z'’-]/g, ''))
    .filter((w) => w.length >= 2);
  if (words.length) {
    for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9'’-]*/g)) {
      const tok = m[0].replace(/['’-]+$/, '');
      if (words.some((w) => fuzzyWordMatch(tok, w))) {
        spans.push({ start: m.index, end: m.index + m[0].length, reason, status: 'accepted' });
      }
    }
  }
  // Numbers (MRN, Medicare, phone): match on digits only, ignoring spacing.
  const digitIdx: number[] = [];
  let digitStr = '';
  for (let i = 0; i < text.length; i++) {
    if (/\d/.test(text[i])) {
      digitStr += text[i];
      digitIdx.push(i);
    }
  }
  for (const t of terms.filter(isNumericTerm)) {
    const td = t.replace(/\D/g, '');
    let at = digitStr.indexOf(td);
    while (at !== -1) {
      spans.push({ start: digitIdx[at], end: digitIdx[at + td.length - 1] + 1, reason, status: 'accepted' });
      at = digitStr.indexOf(td, at + 1);
    }
  }
  return spans;
}

/** All identifier spans found in one line of OCR text. */
export function findSpans(rawText: string, terms: SearchTerms): Span[] {
  const text = normaliseDigits(rawText);
  const name = "[A-Z][A-Za-z'’-]+";
  const initials = '(?:[A-Z]\\.?\\s+)*';
  return [
    ...termSpans(text, terms.patient, 'Matches patient search term'),
    ...termSpans(text, terms.clinician, 'Matches clinician name'),
    ...regexSpans(
      text,
      /(?<!\d)([2-6]\d{3})[ -]?(\d{5})[ -]?(\d)(?:[ -]?\/?[ -]?(\d))?(?!\d)/g,
      'Medicare number',
      'accepted',
      (m) => isValidMedicare(m.slice(1).filter(Boolean).join('')),
    ),
    ...labelled(text, PATIENT_LOOSE, 'optional', /(?:\D*\d){4}/, 'Labelled patient identifier', 'accepted'),
    ...labelled(text, PATIENT_STRICT, 'required', /[A-Za-z0-9]{2}/, 'Labelled patient detail', 'accepted'),
    ...labelled(text, CLINICIAN_LABELS, 'optional', /^[A-Z]/, 'Possible clinician name', 'suggested', words(4)),
    ...regexSpans(text, /(?<!\d)(?:\+?61[ -]?4|04)\d{2}[ -]?\d{3}[ -]?\d{3}(?!\d)/g, 'Mobile number', 'accepted'),
    ...regexSpans(text, /(?<!\d)(?:\+?61[ -]?\(?[2378]\)?|\(?0[2378]\)?)[ -]?\d{4}[ -]?\d{4}(?!\d)/g, 'Phone number', 'accepted'),
    ...regexSpans(text, /[\w.+-]+@[\w-]+\.[\w.]+/g, 'Email address', 'accepted'),
    // Suburb/state/postcode line: redact the whole line.
    ...(new RegExp(`\\b(?:${STATES_UPPER})\\b\\.?,?\\s+\\d{4}\\b`).test(text) ||
    new RegExp(`\\b(?:${STATES_ANYCASE})\\b\\.?,?\\s+\\d{4}\\b`, 'i').test(text)
      ? [{ start: 0, end: text.length, reason: 'Address (state + postcode)', status: 'accepted' as const }]
      : []),
    ...regexSpans(
      text,
      new RegExp(`\\b(?:(?:Unit|U)\\s*\\d+[A-Za-z]?,?\\s+)?\\d{1,5}[A-Za-z]?(?:/\\d{1,5}[A-Za-z]?)?\\s+(?:${name}\\s+){1,3}(?:${STREET_TYPES})\\b\\.?`, 'g'),
      'Street address',
      'accepted',
    ),
    ...regexSpans(text, /\bP\.?\s?O\.?\s+Box\s+\d+/gi, 'PO Box', 'accepted'),
    ...regexSpans(
      text,
      new RegExp(`\\b(?:Dr|Prof|A/Prof|Assoc\\.? Prof)\\.?\\s+${initials}${name}(?:\\s+${name})?`, 'g'),
      'Possible clinician name',
      'suggested',
    ),
    ...regexSpans(
      text,
      new RegExp(`\\b(?:Mr|Mrs|Ms|Miss|Mx|Master)\\.?\\s+${initials}${name}(?:\\s+${name})?`, 'g'),
      'Possible patient name',
      'suggested',
    ),
  ];
}
