// @ts-nocheck
import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Camera, X, Loader2, ImageIcon, Upload } from 'lucide-react';
import { cn, friendlyError } from '@/lib/utils';
import { ImageCropDialog } from './image-crop-dialog';
import { Capacitor } from '@capacitor/core';

interface CroppableImageUploadProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  folder: string;
  userId: string;
  className?: string;
  aspectRatio?: 'square' | 'video' | 'portrait';
  placeholder?: string;
  cropAspect?: number;
  /** Called before opening the native image picker — use to persist state before WebView may reload */
  beforePick?: () => void | Promise<void>;
}

export function CroppableImageUpload({
  value,
  onChange,
  folder,
  userId,
  className,
  aspectRatio = 'square',
  placeholder = 'Upload Image',
  cropAspect,
  beforePick,
}: CroppableImageUploadProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const effectiveCropAspect = cropAspect ?? (aspectRatio === 'video' ? 16 / 9 : aspectRatio === 'portrait' ? 3 / 4 : 1);

  const aspectClasses = {
    square: 'aspect-square',
    video: 'aspect-video',
    portrait: 'aspect-[3/4]',
  };

  const isMobileWeb = !Capacitor.isNativePlatform() && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  const handleUploadBlob = useCallback(async (blob: Blob) => {
    setIsUploading(true);
    try {
      const fileName = `${userId}/${folder}/${Date.now()}.jpg`;
      const { data, error } = await supabase.storage
        .from('app-images')
        .upload(fileName, blob, { cacheControl: '3600', upsert: false, contentType: 'image/jpeg' });
      if (error) throw error;
      const { data: urlData } = supabase.storage.from('app-images').getPublicUrl(data.path);
      onChange(urlData.publicUrl);
      toast.success('Image uploaded successfully');
    } catch (error: any) {
      console.error('Upload error:', error);
      toast.error(friendlyError(error));
    } finally {
      setIsUploading(false);
    }
  }, [userId, folder, onChange]);

  const handleNativePick = useCallback(async () => {
    try {
      const { pickOrCaptureImage } = await import('@/lib/native-media');
      const blob = await pickOrCaptureImage();
      if (blob) {
        const objectUrl = URL.createObjectURL(blob);
        setCropSrc(objectUrl);
      }
    } catch (err: any) {
      if (err?.message?.includes('cancelled') || err?.message?.includes('canceled') || err?.message?.includes('User cancelled')) return;
      console.error('Native pick error:', err);
      if (err?.message?.includes('permission') || err?.message?.includes('Permission')) {
        toast.error(err.message);
      } else {
        toast.error(err?.message || 'Failed to select image');
      }
    }
  }, []);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast.error('Only JPG, PNG, or WebP images are allowed');
      return;
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('Image must be less than 5MB');
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setCropSrc(objectUrl);
    if (inputRef.current) inputRef.current.value = '';
    if (cameraInputRef.current) cameraInputRef.current.value = '';
  };

  const handleCropComplete = async (blob: Blob) => {
    setCropSrc(null);
    await handleUploadBlob(blob);
  };

  const handleRemove = async () => {
    if (!value) return;
    try {
      const url = new URL(value);
      const pathMatch = url.pathname.match(/\/app-images\/(.+)$/);
      if (pathMatch) {
        await supabase.storage.from('app-images').remove([pathMatch[1]]);
      }
    } catch (e) {
      console.log('Could not delete old image');
    }
    onChange(null);
  };

  const handlePickImage = async () => {
    await beforePick?.();
    if (Capacitor.isNativePlatform()) {
      handleNativePick();
    } else {
      inputRef.current?.click();
    }
  };

  const handleCameraCapture = async () => {
    await beforePick?.();
    if (Capacitor.isNativePlatform()) {
      handleNativePick();
    } else {
      cameraInputRef.current?.click();
    }
  };

  return (
    <div className={cn('relative', className)}>
      {/* Gallery / file picker input */}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileSelect}
        className="hidden"
        disabled={isUploading}
      />
      {/* Camera capture input (mobile web) */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileSelect}
        className="hidden"
        disabled={isUploading}
      />

      {value ? (
        <div className={cn('relative rounded-lg overflow-hidden border border-border max-h-48', aspectClasses[aspectRatio])}>
          <img src={value} alt="Uploaded" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/40 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
            {isMobileWeb ? (
              <>
                <Button type="button" size="sm" variant="secondary" onClick={handleCameraCapture} disabled={isUploading}>
                  <Camera size={16} className="mr-1" /> Retake
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={handlePickImage} disabled={isUploading}>
                  <Upload size={16} className="mr-1" /> Gallery
                </Button>
              </>
            ) : (
              <Button type="button" size="sm" variant="secondary" onClick={handlePickImage} disabled={isUploading}>
                <Camera size={16} className="mr-1" /> Change
              </Button>
            )}
            <Button type="button" size="sm" variant="destructive" onClick={handleRemove} disabled={isUploading}>
              <X size={16} />
            </Button>
          </div>
          {isUploading && (
            <div className="absolute inset-0 bg-background/80 flex items-center justify-center">
              <Loader2 className="animate-spin text-primary" size={24} />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {isMobileWeb ? (
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCameraCapture}
                disabled={isUploading}
                className={cn(
                  'rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors',
                  'flex flex-col items-center justify-center gap-1.5 text-muted-foreground h-24 px-3'
                )}
              >
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                  <Camera size={17} className="text-primary" />
                </div>
                <span className="text-xs font-medium">Take Photo</span>
              </button>
              <button
                type="button"
                onClick={handlePickImage}
                disabled={isUploading}
                className={cn(
                  'rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors',
                  'flex flex-col items-center justify-center gap-1.5 text-muted-foreground h-24 px-3'
                )}
              >
                <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                  <ImageIcon size={17} />
                </div>
                <span className="text-xs font-medium">Gallery</span>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handlePickImage}
              disabled={isUploading}
              className={cn(
                'w-full rounded-lg border-2 border-dashed border-muted-foreground/25 hover:border-primary/50 transition-colors',
                'flex flex-col items-center justify-center gap-1.5 text-muted-foreground py-4 px-3'
              )}
            >
              {isUploading ? (
                <Loader2 className="animate-spin" size={24} />
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <ImageIcon size={18} />
                  </div>
                  <div className="text-center min-w-0">
                    <span className="text-xs font-medium block truncate">{placeholder}</span>
                    <span className="text-[10px]">JPG, PNG, WebP</span>
                  </div>
                </>
              )}
            </button>
          )}
          {isUploading && (
            <div className="flex items-center justify-center gap-2 py-2">
              <Loader2 className="animate-spin text-primary" size={18} />
              <span className="text-xs text-muted-foreground">Uploading…</span>
            </div>
          )}
        </div>
      )}

      {cropSrc && (
        <ImageCropDialog
          open={!!cropSrc}
          onOpenChange={(open) => { if (!open) { URL.revokeObjectURL(cropSrc); setCropSrc(null); } }}
          imageSrc={cropSrc}
          aspectRatio={effectiveCropAspect}
          onCropComplete={handleCropComplete}
        />
      )}
    </div>
  );
}