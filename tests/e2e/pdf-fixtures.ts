// Builds small PDFs for tests without using pdf.js, so the app's PDF reading is tested against
// independently made files. All content is fictional.

export interface PdfPageSpec {
  /** JPEG bytes for the scanned page image. */
  jpeg: Buffer;
  width: number;
  height: number;
}

export interface PdfOptions {
  /** Text drawn in invisible mode over the page, like a scanner's OCR layer. */
  hiddenText?: string;
  /** Document metadata (Info dictionary). */
  title?: string;
  author?: string;
  /** Adds a password-protection dictionary (the user password is not empty). */
  encrypted?: boolean;
}

const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

export function makePdf(pages: PdfPageSpec[], opts: PdfOptions = {}): Buffer {
  const parts: Buffer[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (b: Buffer | string) => {
    const buf = typeof b === 'string' ? Buffer.from(b, 'latin1') : b;
    parts.push(buf);
    length += buf.length;
  };
  const objects: (Buffer | string)[][] = [];
  const add = (...chunks: (Buffer | string)[]) => {
    objects.push(chunks);
    return objects.length; // object number
  };

  const catalog = add(''); // placeholder, filled below
  const pagesObj = add('');
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids: number[] = [];
  for (const p of pages) {
    const img = add(
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    );
    let content = 'q 595 0 0 842 0 0 cm /Im0 Do Q\n';
    if (opts.hiddenText) content += `BT /F1 24 Tf 3 Tr 72 760 Td (${esc(opts.hiddenText)}) Tj ET\n`;
    const contents = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
    kids.push(
      add(
        `<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${img} 0 R >> /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`,
      ),
    );
  }
  objects[catalog - 1] = [`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`];
  objects[pagesObj - 1] = [`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`];
  const info = opts.title || opts.author ? add(`<< /Title (${esc(opts.title ?? '')}) /Author (${esc(opts.author ?? '')}) >>`) : 0;
  const encrypt = opts.encrypted ? add(`<< /Filter /Standard /V 1 /R 2 /O <${'28bf4e5e'.repeat(8)}> /U <${'3a5f6c7d'.repeat(8)}> /P -44 >>`) : 0;

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  objects.forEach((chunks, i) => {
    offsets[i] = length;
    push(`${i + 1} 0 obj\n`);
    chunks.forEach(push);
    push('\nendobj\n');
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const o of offsets) push(`${String(o).padStart(10, '0')} 00000 n \n`);
  const id = '0123456789abcdef0123456789abcdef';
  push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R${info ? ` /Info ${info} 0 R` : ''}${encrypt ? ` /Encrypt ${encrypt} 0 R` : ''} /ID [<${id}> <${id}>] >>\nstartxref\n${xref}\n%%EOF\n`,
  );
  return Buffer.concat(parts);
}
