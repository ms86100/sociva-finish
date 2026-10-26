// @ts-nocheck
import { Capacitor } from '@capacitor/core';

export const MEDIA_PERMISSION_MESSAGE =
  'Allow camera and photos in your device Settings to change your photo.';

const SETTINGS_HINT = MEDIA_PERMISSION_MESSAGE;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isCancelledError(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
  return msg.includes('cancel') || msg.includes('cancelled') || msg.includes('canceled');
}

function isMediaPermissionFailure(err: unknown): boolean {
  const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
  if (isCancelledError(err)) return false;
  return (
    msg.includes('permission') ||
    msg.includes('denied') ||
    msg.includes('not allowed') ||
    msg.includes('securityexception') ||
    msg.includes('notallowederror') ||
    msg.includes('access to camera') ||
    msg.includes('access to photo') ||
    msg.includes('access to photos') ||
    msg.includes('photo library')
  );
}

function rethrowMediaError(err: unknown): never {
  if (isCancelledError(err)) throw err;
  if (isMediaPermissionFailure(err)) {
    throw new Error(SETTINGS_HINT);
  }
  throw err instanceof Error ? err : new Error(String(err ?? 'Failed to select image'));
}

function isGranted(status: string | undefined): boolean {
  return status === 'granted' || status === 'limited';
}

/**
 * Ask the OS for camera and/or photo-library access before opening the picker.
 * Returns which capabilities are available after the prompt.
 */
async function ensureMediaPermissions(opts: {
  camera?: boolean;
  photos?: boolean;
}): Promise<{ cameraOk: boolean; photosOk: boolean }> {
  const wantCamera = !!opts.camera;
  const wantPhotos = !!opts.photos;
  const { Camera } = await import('@capacitor/camera');

  let status = await Camera.checkPermissions();

  const toRequest: Array<'camera' | 'photos'> = [];
  if (wantCamera && !isGranted(status.camera)) toRequest.push('camera');
  if (wantPhotos && !isGranted(status.photos)) toRequest.push('photos');

  if (toRequest.length > 0) {
    status = await Camera.requestPermissions({ permissions: toRequest });
    // Let iOS finish dismissing the system sheet before Camera.getPhoto.
    await delay(450);
  }

  return {
    cameraOk: !wantCamera || isGranted(status.camera),
    photosOk: !wantPhotos || isGranted(status.photos),
  };
}

/** Open the app's system Settings page so the user can enable camera/photos. */
export async function openMediaSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings');
    await NativeSettings.open({
      optionIOS: IOSSettings.App,
      optionAndroid: AndroidSettings.ApplicationDetails,
    });
  } catch {
    // Best-effort; callers already showed the Settings hint toast.
  }
}

/** Uri avoids stuffing a huge DataUrl into the WebView heap (which can reload the page). */
function cameraPhotoOptions(overrides: Record<string, unknown> = {}) {
  return {
    resultType: 'uri' as const,
    quality: 80,
    width: 1600,
    correctOrientation: true,
    saveToGallery: false,
    ...overrides,
  };
}

async function photoToBlob(photo: {
  webPath?: string;
  dataUrl?: string;
  base64String?: string;
}): Promise<Blob> {
  if (photo.webPath) {
    const response = await fetch(photo.webPath);
    return response.blob();
  }
  if (photo.dataUrl) {
    const response = await fetch(photo.dataUrl);
    return response.blob();
  }
  if (photo.base64String) {
    const response = await fetch(`data:image/jpeg;base64,${photo.base64String}`);
    return response.blob();
  }
  throw new Error('No image selected');
}

/**
 * Pick a photo from the gallery using native Camera plugin on iOS/Android.
 * Returns a Blob ready for upload.
 * On web, returns null so callers can fall back to <input type="file">.
 */
export async function pickImageFromGallery(): Promise<Blob | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const { photosOk } = await ensureMediaPermissions({ photos: true });
    if (!photosOk) {
      throw new Error(SETTINGS_HINT);
    }

    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      source: CameraSource.Photos,
      ...cameraPhotoOptions({ resultType: CameraResultType.Uri }),
    });

    return photoToBlob(photo);
  } catch (err) {
    rethrowMediaError(err);
  }
}

/**
 * Capture a photo using the native camera on iOS/Android.
 * Returns a Blob ready for upload.
 * On web, returns null so callers can fall back to getUserMedia.
 */
export async function capturePhotoFromCamera(): Promise<Blob | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const { cameraOk } = await ensureMediaPermissions({ camera: true });
    if (!cameraOk) {
      throw new Error(SETTINGS_HINT);
    }

    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
    const photo = await Camera.getPhoto({
      source: CameraSource.Camera,
      ...cameraPhotoOptions({ resultType: CameraResultType.Uri, width: 1600 }),
    });

    return photoToBlob(photo);
  } catch (err) {
    rethrowMediaError(err);
  }
}

/**
 * Prompt user to choose camera or gallery (native only).
 * Requests OS permissions first so the system Allow dialog appears,
 * then opens the picker with a source that matches what was granted.
 * Returns a Blob or null (web fallback).
 */
export async function pickOrCaptureImage(): Promise<Blob | null> {
  if (!Capacitor.isNativePlatform()) return null;

  try {
    const { cameraOk, photosOk } = await ensureMediaPermissions({
      camera: true,
      photos: true,
    });

    if (!cameraOk && !photosOk) {
      throw new Error(SETTINGS_HINT);
    }

    const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');

    // Match source to granted access so iOS does not open Photos without library permission.
    let source = CameraSource.Prompt;
    if (cameraOk && !photosOk) source = CameraSource.Camera;
    else if (photosOk && !cameraOk) source = CameraSource.Photos;

    const photo = await Camera.getPhoto({
      source,
      ...cameraPhotoOptions({ resultType: CameraResultType.Uri }),
    });

    return photoToBlob(photo);
  } catch (err) {
    rethrowMediaError(err);
  }
}
