import type { Browser } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Entirely fictional test patient. No real patient data is ever used in tests.
export const FAKE = {
  surname: 'TESTPERSON',
  given: 'Alexandra',
  mrn: '7654321',
  medicare: '2123 45670 1',
  dob: '03/04/1955',
  phone: '0412 345 678',
};

export const SEARCH_TERMS = `${FAKE.surname}\n${FAKE.given}\n${FAKE.mrn}`;

const DIR = join(process.cwd(), 'tests', 'fixtures', 'generated');

/** Draws synthetic notes / Cirrus / Optos images in a blank page and saves them as PNGs. */
export async function makeFixtures(browser: Browser): Promise<Record<'notes' | 'cirrus' | 'optos2', string>> {
  const page = await browser.newPage();
  const images = await page.evaluate((f) => {
    const make = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      draw(c.getContext('2d')!);
      return c.toDataURL('image/png');
    };
    const text = (ctx: CanvasRenderingContext2D, lines: string[], x: number, y: number, size: number, color = '#111') => {
      ctx.fillStyle = color;
      ctx.font = `${size}px sans-serif`;
      lines.forEach((l, i) => ctx.fillText(l, x, y + i * size * 1.45));
    };

    // Paper notes, photographed slightly rotated on a dark desk.
    const notes = make(1700, 2300, (ctx) => {
      ctx.fillStyle = '#2b2b2b';
      ctx.fillRect(0, 0, 1700, 2300);
      ctx.translate(850, 1150);
      ctx.rotate((3 * Math.PI) / 180);
      ctx.translate(-750, -1050);
      ctx.fillStyle = '#fbfbf7';
      ctx.fillRect(0, 0, 1500, 2100);
      // Sticker, top right.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(840, 30, 620, 420);
      ctx.strokeStyle = '#999';
      ctx.strokeRect(840, 30, 620, 420);
      text(ctx, [`${f.surname}, ${f.given}`, `MRN ${f.mrn}  DOB ${f.dob}`, '12 Example Street', 'RICHMOND VIC 3121', `Ph ${f.phone}`, `Medicare ${f.medicare}`], 860, 80, 34);
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = '#000';
        ctx.fillRect(860 + i * 13, 380, i % 3 === 0 ? 7 : 3, 50);
      }
      text(
        ctx,
        [
          'Ophthalmology review',
          `${f.given} ${f.surname} reports blurred vision OD`,
          'VA 6/9 OD, 6/6 OS. IOP 14 / 15 mmHg',
          'Fundus: few dot haemorrhages OD',
          'Plan: OCT macula, review 6 weeks',
          'Seen by Dr Jane Smith',
        ],
        80,
        620,
        44,
      );
    });

    // Cirrus report screen.
    const cirrus = make(1800, 1200, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 1800, 1200);
      text(ctx, [`Patient: ${f.surname}, ${f.given}`, `ID: ${f.mrn}`, `DOB: ${f.dob}`], 40, 50, 30);
      text(ctx, ['Exam Date: 05/06/2026', 'Signal Strength: 9/10', 'Macular Cube 512x128'], 1000, 50, 30);
      text(ctx, ['OD', 'Central subfield thickness 312 um'], 40, 400, 40);
      ctx.fillStyle = '#9ad';
      ctx.fillRect(40, 520, 1700, 600);
    });

    // Optos pair: toolbar plus an overlay on each image.
    const optos2 = make(2000, 1100, (ctx) => {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 2000, 1100);
      ctx.fillStyle = '#d8d8d8';
      ctx.fillRect(0, 0, 2000, 80);
      text(ctx, [`${f.surname}, ${f.given}   ${f.mrn}   ${f.dob}`], 20, 52, 32);
      for (const cx of [500, 1500]) {
        const g = ctx.createRadialGradient(cx, 620, 50, cx, 620, 420);
        g.addColorStop(0, '#c86b3c');
        g.addColorStop(1, '#3a1608');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, 620, 420, 0, Math.PI * 2);
        ctx.fill();
      }
      text(ctx, [`${f.surname}, ${f.given}`, f.mrn, 'R'], 20, 130, 30, '#fff');
      text(ctx, [`${f.surname}, ${f.given}`, f.mrn, 'L'], 1020, 130, 30, '#fff');
    });

    return { notes, cirrus, optos2 };
  }, FAKE);
  await page.close();
  mkdirSync(DIR, { recursive: true });
  const out = {} as Record<'notes' | 'cirrus' | 'optos2', string>;
  for (const [k, v] of Object.entries(images)) {
    const path = join(DIR, `${k}.png`);
    writeFileSync(path, Buffer.from(v.split(',')[1], 'base64'));
    out[k as keyof typeof out] = path;
  }
  return out;
}
