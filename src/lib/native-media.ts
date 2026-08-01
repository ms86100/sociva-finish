// @ts-nocheck
import { Capacitor } from '@capacitor/core';

/**
 * Ensure camera and photo library permissions are granted.
 * Must be called before any Camera.getPhoto() call.
 */
async function ensureCameraPermissions(source: 'camera' | 'photos' | 'prompt'): Promise<void> {
  const { Camera } = await import('@capacitor/camera');
  const status = await Camera.checkPermissions();

  const needsCamera = source === 'camera' || source === 'prompt';
  const needsPhotos = source === 'photos' || source === 'prompt';

  const cameraGranted = status.camera === 'granted';
  const photosGranted = status.photos === 'granted' || status.photos === 'limited';

  if ((needsCamera && !cameraGranted) || (needsPhotos && !photosGranted)) {
    const requested = await Camera.requestPermissions({
      permissions: [
        ...(needsCamera && !cameraGranted ? ['camera' as const] : []),
        ...(needsPhotos && !photosGranted ? ['photos' as const] : []),
      ],
    });

    if (needsCamera && requested.camera === 'denied') {
      throw new Error('Camera permission denied. Please enable it in your device Settings.');
    }
    // On iOS 14+, 'limited' is a valid granted state for photos
    if (needsPhotos && requested.photos === 'denied') {
      throw new Error('Photo library permission denied. Please enable it in your device Settings.');
    }
  }
}

/**
 * Pick a photo from the gallery using native Camera plugin on iOS/Android.
 * Returns a Blob ready for upload.
 * On web, returns null so callers can fall back to <input type="file">.
 */
export async function pickImageFromGallery(): Promise<Blob | null> {
  if (!Capacitor.isNativePlatform()) return null;

  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');

  // Ensure permissions with delay for iOS
  const permStatus = await Camera.checkPermissions();
  if (permStatus.photos !== 'granted' && permStatus.photos !== 'limited') {
    const requested = await Camera.requestPermissions({ permissions: ['photos'] });
    if (requested.photos === 'denied') {
      throw new Error('Photo library permission denied. Please enable it in your device Settings.');
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const photo = await Camera.getPhoto({
    source: CameraSource.Photos,
    resultType: CameraResultType.DataUrl,
    quality: 85,
  });

  if (photo.dataUrl) {
    const response = await fetch(photo.dataUrl);
    return response.blob();
  }
  if (photo.webPath) {
    const response = await fetch(photo.webPath);
    return response.blob();
  }
  throw new Error('No image selected');
}

/**
 * Capture a photo using the native camera on iOS/Android.
 * Returns a Blob ready for upload.
 * On web, returns null so callers can fall back to getUserMedia.
 */
export async function capturePhotoFromCamera(): Promise<Blob | null> {
  if (!Capacitor.isNativePlatform()) return null;

  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');

  // Ensure permissions with delay for iOS
  const permStatus = await Camera.checkPermissions();
  if (permStatus.camera !== 'granted') {
    const requested = await Camera.requestPermissions({ permissions: ['camera'] });
    if (requested.camera === 'denied') {
      throw new Error('Camera permission denied. Please enable it in your device Settings.');
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const photo = await Camera.getPhoto({
    source: CameraSource.Camera,
    resultType: CameraResultType.DataUrl,
    quality: 85,
    width: 640,
    height: 480,
  });

  if (photo.dataUrl) {
    const response = await fetch(photo.dataUrl);
    return response.blob();
  }
  if (photo.webPath) {
    const response = await fetch(photo.webPath);
    return response.blob();
  }
  throw new Error('No photo captured');
}

/**
 * Prompt user to choose camera or gallery (native only).
 * Returns a Blob or null (web fallback).
 */
export async function pickOrCaptureImage(): Promise<Blob | null> {
  if (!Capacitor.isNativePlatform()) return null;

  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');

  // Request permissions first, separately from the getPhoto call
  // This prevents the permission dialog from breaking the gesture context
  const permStatus = await Camera.checkPermissions();
  const needsCamera = permStatus.camera !== 'granted';
  const needsPhotos = permStatus.photos !== 'granted' && permStatus.photos !== 'limited';

  if (needsCamera || needsPhotos) {
    const requested = await Camera.requestPermissions({
      permissions: [
        ...(needsCamera ? ['camera' as const] : []),
        ...(needsPhotos ? ['photos' as const] : []),
      ],
    });

    if (requested.camera === 'denied') {
      throw new Error('Camera permission denied. Please enable it in your device Settings.');
    }
    if (requested.photos === 'denied') {
      throw new Error('Photo library permission denied. Please enable it in your device Settings.');
    }

    // Wait a moment for iOS to finish dismissing the permission dialog
    // before invoking the image picker — this prevents "Failed to select image"
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const photo = await Camera.getPhoto({
    source: CameraSource.Prompt,
    resultType: CameraResultType.DataUrl,
    quality: 85,
  });

  if (photo.dataUrl) {
    const response = await fetch(photo.dataUrl);
    return response.blob();
  }

  if (photo.webPath) {
    const response = await fetch(photo.webPath);
    return response.blob();
  }

  throw new Error('No image selected');
}
