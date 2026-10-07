import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crc32, makeZip } from '../../src/export/zip';

describe('crc32', () => {
  it('matches known vectors', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });
});

describe('makeZip', () => {
  const files = [
    { name: 'case-image-001.jpg', blob: new Blob([new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9])]) },
    { name: 'case-image-002.jpg', blob: new Blob([new Uint8Array(70000).map((_, i) => i % 251)]) },
    { name: 'empty.bin', blob: new Blob([]) },
  ];

  it('produces an archive that Python’s zipfile accepts, with exact contents and no timestamps', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zip-'));
    const zip = join(dir, 'out.zip');
    writeFileSync(zip, Buffer.from(await (await makeZip(files)).arrayBuffer()));
    const script = [
      'import sys, zipfile',
      'z = zipfile.ZipFile(sys.argv[1])',
      'assert z.testzip() is None',
      'for i in z.infolist():',
      '    assert i.date_time == (1980, 1, 1, 0, 0, 0), i.date_time',
      '    print(i.filename, len(z.read(i.filename)), i.compress_type)',
    ].join('\n');
    const r = spawnSync('python3', ['-I', '-c', script, zip], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.stdout.trim().split('\n')).toEqual(['case-image-001.jpg 7 0', 'case-image-002.jpg 70000 0', 'empty.bin 0 0']);
  });

  it('handles an empty list', async () => {
    const buf = new Uint8Array(await (await makeZip([])).arrayBuffer());
    expect(buf.length).toBe(22);
  });
});
