import { useEffect, useRef } from 'preact/hooks';

/** Small on-screen preview drawn from an in-memory canvas. */
export function Thumb({ src, size = 160 }: { src: HTMLCanvasElement; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || !src.width) return;
    const scale = size / Math.max(src.width, src.height);
    c.width = Math.max(1, Math.round(src.width * scale));
    c.height = Math.max(1, Math.round(src.height * scale));
    c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
    return () => {
      c.width = 0;
      c.height = 0;
    };
  }, [src, src.width, src.height, size]);
  return <canvas ref={ref} class="thumb" />;
}
