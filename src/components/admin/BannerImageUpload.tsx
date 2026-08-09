// @ts-nocheck
import { useState, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { adminNotify } from '@/lib/admin-notify';
import { cn, friendlyError } from '@/lib/utils';
import { notify } from '@/lib/notify';

interface BannerImageUploadProps {
  value: string;
  onChange: (url: string) => void;
  label?: string;
}

export function BannerImageUpload({ value, onChange, label = 'Banner Image' }: BannerImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const uploadFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      notify.block('Please upload an image file');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      adminNotify.error('Image must be under 5MB');
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split('.').pop() || 'jpg';
      const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const filePath = `banners/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('banner-images')
        .upload(filePath, file, { cacheControl: '3600', upsert: false });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('banner-images')
        .getPublicUrl(filePath);

      onChange(publicUrl);
      adminNotify.success('Image uploaded');
    } catch (err: any) {
      adminNotify.error(friendlyError(err) || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, [onChange]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  }, [uploadFile]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-2">
      <Label className="text-xs font-semibold">{label}</Label>

      {value ? (
        <div className="relative rounded-xl overflow-hidden border border-border/40">
          <img src={value} alt="Banner" className="w-full h-28 object-cover" />
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute top-2 right-2 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={cn(
            'rounded-xl border-2 border-dashed p-6 text-center cursor-pointer transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-border/60 hover:border-primary/40',
            uploading && 'pointer-events-none opacity-60'
          )}
        >
          {uploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 size={24} className="animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Uploading…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
                <Upload size={18} className="text-muted-foreground" />
              </div>
              <p className="text-xs font-medium text-muted-foreground">
                Drag & drop or <span className="text-primary font-semibold">browse</span>
              </p>
              <p className="text-[10px] text-muted-foreground/60">PNG, JPG up to 5MB</p>
            </div>
          )}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Fallback: paste URL */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] text-muted-foreground">or paste URL:</span>
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="https://..."
          className="rounded-xl h-7 text-xs flex-1"
        />
      </div>
    </div>
  );
}
