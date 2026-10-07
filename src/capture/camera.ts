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
 * otherwise grabs the current video frame. The photo is held in memory and
 * never written to the gallery.
 */
export async function capturePhoto(stream: MediaStream, video: HTMLVideoElement): Promise<Blob> {
  const track = stream.getVideoTracks()[0];
  const IC = (window as unknown as { ImageCapture?: new (t: MediaStreamTrack) => ImageCaptureLike }).ImageCapture;
  if (IC && track) {
    try {
      return await new IC(track).takePhoto();
    } catch {
      // Fall through to a video frame.
    }
  }
  const c = document.createElement('canvas');
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext('2d')!.drawImage(video, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.95));
  c.width = 0;
  c.height = 0;
  if (!blob) throw new Error('Could not capture');
  return blob;
}
