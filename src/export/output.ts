export type Format = 'image/jpeg' | 'image/png';

export function toBlob(canvas: HTMLCanvasElement, type: Format): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not encode image'))), type, 0.92),
  );
}

let counter = 1;
/** Generic file names only: never derived from the original photo's name. */
export const exportName = (type: Format) => `case-image-${counter++}.${type === 'image/png' ? 'png' : 'jpg'}`;

export const canCopyImage = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

export async function copyImage(canvas: HTMLCanvasElement): Promise<void> {
  // Chrome's clipboard only accepts PNG images.
  const blob = await toBlob(canvas, 'image/png');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

interface SavePickerWindow {
  showSaveFilePicker?: (opts: unknown) => Promise<{ createWritable(): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }> }>;
}

export async function saveImage(canvas: HTMLCanvasElement, type: Format): Promise<void> {
  const blob = await toBlob(canvas, type);
  const name = exportName(type);
  const picker = (window as SavePickerWindow).showSaveFilePicker;
  if (picker) {
    try {
      const ext = type === 'image/png' ? '.png' : '.jpg';
      const handle = await picker({ suggestedName: name, types: [{ description: 'Image', accept: { [type]: [ext] } }] });
      const w = await handle.createWritable();
      await w.write(blob);
      await w.close();
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
      // Fall back to a normal download.
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function canShareFiles(): boolean {
  try {
    const probe = new File([new Uint8Array(1)], 'x.jpg', { type: 'image/jpeg' });
    return !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareImage(canvas: HTMLCanvasElement, type: Format): Promise<void> {
  const blob = await toBlob(canvas, type);
  const file = new File([blob], exportName(type), { type });
  try {
    await navigator.share({ files: [file], title: 'De-identified image' });
  } catch (e) {
    if ((e as DOMException).name !== 'AbortError') throw e;
  }
}
