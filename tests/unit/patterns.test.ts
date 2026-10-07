import { describe, expect, it } from 'vitest';
import { findSpans, fuzzyWordMatch, isValidMedicare, normaliseDigits } from '../../src/detect/patterns';
import type { SearchTerms } from '../../src/types';

const none: SearchTerms = { patient: [], clinician: [] };
const covered = (text: string, terms = none) =>
  findSpans(text, terms).map((s) => ({ text: text.slice(s.start, s.end), reason: s.reason, status: s.status }));
const texts = (text: string, terms = none) => [...new Set(covered(text, terms).map((c) => c.text))];

describe('Medicare', () => {
  it('validates the check digit', () => {
    expect(isValidMedicare('2123456701')).toBe(true);
    expect(isValidMedicare('21234567011')).toBe(true);
    expect(isValidMedicare('2123456791')).toBe(false);
    expect(isValidMedicare('1123456701')).toBe(false);
  });

  it('finds spaced Medicare numbers with a valid check digit only', () => {
    expect(texts('Card 2123 45670 1')).toContain('2123 45670 1');
    expect(texts('Card 2123 45679 1')).not.toContain('2123 45679 1');
  });

  it('tolerates OCR letter/digit confusion', () => {
    expect(normaliseDigits('2l23 4567O 1')).toBe('2123 45670 1');
    expect(normaliseDigits('Oliver')).toBe('Oliver');
  });
});

describe('labelled fields', () => {
  it('covers sticker values', () => {
    const t = texts('MRN 1234567 DOB 01/02/1950');
    expect(t).toContain('1234567');
    expect(t).toContain('01/02/1950');
  });

  it('stops a value at the next label, keeping exam date visible', () => {
    const line = 'Patient: SMITH, John DOB: 03/04/1955 Exam Date: 05/06/2026';
    const t = texts(line);
    expect(t).toContain('SMITH, John');
    expect(t).toContain('03/04/1955');
    expect(t.some((x) => x.includes('05/06/2026'))).toBe(false);
  });

  it('limits values to their expected shape when OCR merges columns', () => {
    expect(texts('DOB: 03/04/1955 Macular Cube 512x128')).toEqual(['03/04/1955']);
    expect(texts('Patient ID: 7654321 Macular Cube')).toEqual(['7654321']);
    expect(texts('DOB 3 Apr 1955 OD')).toEqual(['3 Apr 1955']);
  });

  it('does not treat pH as a phone label', () => {
    expect(texts('pH 7.4')).toEqual([]);
  });

  it('marks clinician fields as suggestions', () => {
    const c = covered('Technician: Jones, Amy Signal Strength: 9/10');
    expect(c).toContainEqual({ text: 'Jones, Amy', reason: 'Possible clinician name', status: 'suggested' });
    expect(c.some((x) => x.text.includes('9/10'))).toBe(false);
  });
});

describe('contact details and addresses', () => {
  it('finds mobile and landline numbers', () => {
    expect(texts('Ph 0412 345 678')).toContain('0412 345 678');
    expect(texts('call (03) 9123 4567 today')).toContain('(03) 9123 4567');
  });

  it('covers a suburb/state/postcode line and a street line', () => {
    expect(texts('RICHMOND VIC 3121')).toContain('RICHMOND VIC 3121');
    expect(texts('12 Example Street')).toContain('12 Example Street');
  });

  it('does not flag ordinary clinical text', () => {
    expect(texts('VA 6/9 OD, IOP 14 mmHg, CMT 312 um')).toEqual([]);
  });
});

describe('search terms', () => {
  const terms = { patient: ['Testperson', 'Alexandra', '1234567'], clinician: ['Drnameson'] };

  it('matches names case-insensitively with one OCR error', () => {
    expect(texts('re: TESTPERS0N, Alexandr', terms)).toEqual(expect.arrayContaining(['TESTPERS0N', 'Alexandr']));
    expect(fuzzyWordMatch('Testpersan', 'Testperson')).toBe(true);
    expect(fuzzyWordMatch('Tom', 'Tim')).toBe(false);
  });

  it('matches numbers regardless of spacing', () => {
    expect(texts('UR 123 4567', terms)).toContain('123 4567');
  });

  it('finds clinician names and titles', () => {
    const c = covered('Dear Dr Smith, thank you for seeing Mrs Jane Doe. Drnameson', terms);
    expect(c).toContainEqual({ text: 'Dr Smith', reason: 'Possible clinician name', status: 'suggested' });
    expect(c).toContainEqual({ text: 'Mrs Jane Doe', reason: 'Possible patient name', status: 'suggested' });
    expect(c).toContainEqual({ text: 'Drnameson', reason: 'Matches clinician name', status: 'accepted' });
  });
});
