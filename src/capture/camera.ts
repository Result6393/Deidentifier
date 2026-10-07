import { bitmapToCanvas } from './load';

export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 4096 }, height: { ideal: 3072 } },
  });
  video.srcObject = stream;
  await video.play();
  return stream;
}

export function stopCamera(stream: MediaStream | null, video?: HTMLVideoElement | null): void {
  stream?.getTracks().forEach((t) => t.stop());
  if (video) video.srcObject = null;
}

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}

/**
 * Takes a full-resolution still when the browser supports ImageCapture,
 * otherwise grabs the current video frame. The photo goes straight into a
 * canvas and is never written to the gallery.
 */
export async function capturePhoto(stream: MediaStream, video: HTMLVideoElement): Promise<HTMLCanvasElement> {
  const track = stream.getVideoTracks()[0];
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  if (IC && track) {
    try {
      const blob = await new IC(track).takePhoto();
      const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
      try {
        return bitmapToCanvas(bmp, bmp.width, bmp.height);
      } finally {
        bmp.close();
      }
    } catch {
      // Fall through to a video frame.
    }
  }
  return bitmapToCanvas(video, video.videoWidth, video.videoHeight);
}
