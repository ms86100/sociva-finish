// @ts-nocheck
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Camera, ImagePlus, X, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { pickOrCaptureImage } from '@/lib/native-media';
import { supabase } from '@/integrations/supabase/client';

interface MultiImageCaptureProps {
  value: string[];
  onChange: (urls: string[]) => void;
  bucket?: string;
  pathPrefix?: string;
  max?: number;
  maxSizeMB?: number;
  disabled?: boolean;
}

const DEFAULT_BUCKET = 'app-images';

export function MultiImageCapture({
  value,
  onChange,
  bucket = DEFAULT_BUCKET,
  pathPrefix = 'evidence',
  max = 3,
  maxSizeMB = 5,
  disabled,
}: MultiImageCaptureProps) {
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function uploadBlob(blob: Blob, filename: string) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const ext = (filename.split('.').pop() || 'jpg').toLowerCase();
    const path = `${pathPrefix}/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from(bucket).upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from(bucket).getPublicUrl(path);
    return data.publicUrl;
  }

  async function processFiles(files: File[]) {
    const remaining = max - value.length;
    if (remaining <= 0) {
      toast.error(`Maximum ${max} images`);
      return;
    }
    const accepted = files.slice(0, remaining);
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of accepted) {
        if (file.size > maxSizeMB * 1024 * 1024) {
          toast.error(`${file.name} exceeds ${maxSizeMB}MB`);
          continue;
        }
        const url = await uploadBlob(file, file.name);
        urls.push(url);
      }
      if (urls.length) onChange([...value, ...urls]);
    } catch (err: any) {
      toast.error(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleNative() {
    try {
      setUploading(true);
      const blob = await pickOrCaptureImage();
      if (!blob) return;
      if (blob.size > maxSizeMB * 1024 * 1024) {
        toast.error(`Image exceeds ${maxSizeMB}MB`);
        return;
      }
      const url = await uploadBlob(blob, 'photo.jpg');
      onChange([...value, url]);
    } catch (err: any) {
      toast.error(err.message || 'Capture failed');
    } finally {
      setUploading(false);
    }
  }

  const isNative = typeof window !== 'undefined' && Capacitor?.isNativePlatform?.();
  const reachedMax = value.length >= max;

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {value.map((url, i) => (
            <div key={url} className="relative w-16 h-16 rounded-lg overflow-hidden border border-border">
              <img src={url} alt={`evidence ${i + 1}`} className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => onChange(value.filter((u) => u !== url))}
                className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded-bl-lg p-0.5"
                aria-label="Remove"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {!reachedMax && (
        <div className="flex gap-2">
          {isNative ? (
            <Button type="button" variant="outline" size="sm" onClick={handleNative} disabled={disabled || uploading} className="flex-1">
              {uploading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Camera size={14} className="mr-1" />}
              Add photo
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => cameraRef.current?.click()}
                disabled={disabled || uploading}
                className="flex-1"
              >
                {uploading ? <Loader2 size={14} className="animate-spin mr-1" /> : <Camera size={14} className="mr-1" />}
                Camera
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => galleryRef.current?.click()}
                disabled={disabled || uploading}
                className="flex-1"
              >
                <ImagePlus size={14} className="mr-1" />
                Gallery
              </Button>
            </>
          )}
        </div>
      )}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) processFiles(files);
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          if (files.length) processFiles(files);
        }}
      />

      <p className="text-[10px] text-muted-foreground">
        {value.length}/{max} photos · max {maxSizeMB}MB each
      </p>
    </div>
  );
}
