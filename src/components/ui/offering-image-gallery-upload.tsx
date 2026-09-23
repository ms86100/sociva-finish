// @ts-nocheck
import { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { ProductImageUpload } from '@/components/ui/product-image-upload';
import {
  MAX_OFFERING_IMAGES,
  canRemoveOfferingImage,
  offeringImagesLabel,
  resolveOfferingImages,
} from '@/lib/offering-images';
import { cn } from '@/lib/utils';

interface OfferingImageGalleryUploadProps {
  value: string[];
  onChange: (urls: string[]) => void;
  userId: string;
  className?: string;
  beforePick?: () => void | Promise<void>;
  disabled?: boolean;
}

/**
 * Seller gallery: 1 required, up to 5 optional.
 * First image is the primary/cover everywhere in Sociva.
 */
export function OfferingImageGalleryUpload({
  value,
  onChange,
  userId,
  className,
  beforePick,
  disabled,
}: OfferingImageGalleryUploadProps) {
  const images = resolveOfferingImages({
    image_url: value[0] ?? null,
    secondary_images: value.slice(1),
  });
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const [adding, setAdding] = useState(images.length === 0);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);

  const setImages = (next: string[]) => {
    const capped = resolveOfferingImages({
      image_url: next[0] ?? null,
      secondary_images: next.slice(1),
    });
    onChange(capped);
    setAdding(capped.length === 0);
    setReplaceIndex(null);
  };

  const removeAt = (index: number) => {
    if (!canRemoveOfferingImage(images.length)) {
      toast.error('At least 1 photo is required');
      return;
    }
    setImages(images.filter((_, i) => i !== index));
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= images.length) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    setImages(next);
  };

  const handleAddUrl = (url: string | null) => {
    if (!url) return;
    const current = imagesRef.current;
    if (current.length >= MAX_OFFERING_IMAGES) {
      toast.error('Maximum 5 photos');
      setAdding(false);
      return;
    }
    // Append against latest gallery — avoids stale closure replacing prior photos
    // when uploads finish close together.
    setImages([...current, url]);
  };

  const handleReplaceUrl = (url: string | null) => {
    if (replaceIndex == null) return;
    if (!url) {
      setReplaceIndex(null);
      return;
    }
    const next = [...imagesRef.current];
    next[replaceIndex] = url;
    setImages(next);
  };

  const showAddSlot = images.length < MAX_OFFERING_IMAGES && !disabled;

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs text-muted-foreground">{offeringImagesLabel(images.length)}</p>

      {images.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {images.map((url, i) => (
            <div
              key={`${url}-${i}`}
              data-testid="offering-image"
              className="relative w-[72px] h-[72px] rounded-lg overflow-hidden border border-border bg-muted group"
            >
              <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              {i === 0 && (
                <span className="absolute bottom-0 inset-x-0 bg-primary/90 text-primary-foreground text-[9px] font-semibold text-center py-0.5 flex items-center justify-center gap-0.5">
                  <Star size={8} fill="currentColor" /> Cover
                </span>
              )}
              {!disabled && (
                <>
                  <button
                    type="button"
                    onClick={() => removeAt(i)}
                    className="absolute top-0 right-0 bg-destructive text-destructive-foreground rounded-bl-md p-0.5"
                    aria-label="Remove photo"
                  >
                    <X size={12} />
                  </button>
                  <div className="absolute top-0 left-0 flex flex-col gap-0.5">
                    {i > 0 && (
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        className="bg-background/90 text-foreground rounded-br-md p-0.5"
                        aria-label="Move earlier"
                      >
                        <ChevronLeft size={12} />
                      </button>
                    )}
                    {i < images.length - 1 && (
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        className="bg-background/90 text-foreground rounded-br-md p-0.5"
                        aria-label="Move later"
                      >
                        <ChevronRight size={12} />
                      </button>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => { setReplaceIndex(i); setAdding(false); }}
                    className="absolute inset-x-0 top-1/2 -translate-y-1/2 mx-1 text-[9px] font-medium bg-background/85 rounded py-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    Replace
                  </button>
                </>
              )}
            </div>
          ))}

          {showAddSlot && !adding && replaceIndex == null && (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="w-[72px] h-[72px] rounded-lg border border-dashed border-border flex flex-col items-center justify-center gap-0.5 text-muted-foreground hover:bg-muted/50 transition-colors"
              aria-label="Add photo"
            >
              <Plus size={18} />
              <span className="text-[9px] font-medium">Add</span>
            </button>
          )}
        </div>
      )}

      {(adding || images.length === 0) && replaceIndex == null && (
        <ProductImageUpload
          value={null}
          onChange={handleAddUrl}
          userId={userId}
          beforePick={beforePick}
          placeholder={images.length === 0 ? 'Upload product photo' : 'Add another photo'}
        />
      )}

      {replaceIndex != null && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Replace photo {replaceIndex + 1}</p>
          <ProductImageUpload
            value={null}
            onChange={handleReplaceUrl}
            userId={userId}
            beforePick={beforePick}
            placeholder="Choose replacement photo"
          />
          <button
            type="button"
            className="text-xs text-muted-foreground underline"
            onClick={() => setReplaceIndex(null)}
          >
            Cancel replace
          </button>
        </div>
      )}
    </div>
  );
}
