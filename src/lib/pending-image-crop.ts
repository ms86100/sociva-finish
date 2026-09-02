const PENDING_CROP_KEY = 'sociva-pending-image-crop';

export interface PendingImageCrop {
  dataUrl: string;
  folder?: string;
  slot?: string;
}

export function readPendingImageCrop(): PendingImageCrop | null {
  try {
    const raw = sessionStorage.getItem(PENDING_CROP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.dataUrl || typeof parsed.dataUrl !== 'string') return null;
    if (!parsed.dataUrl.startsWith('data:image/')) return null;
    return parsed as PendingImageCrop;
  } catch {
    return null;
  }
}

export function writePendingImageCrop(pending: PendingImageCrop): void {
  try {
    sessionStorage.setItem(PENDING_CROP_KEY, JSON.stringify(pending));
  } catch {
    /* quota — crop still works in-memory */
  }
}

export function clearPendingImageCrop(): void {
  try {
    sessionStorage.removeItem(PENDING_CROP_KEY);
  } catch {
    /* ignore */
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Failed to read image'));
    reader.readAsDataURL(blob);
  });
}
