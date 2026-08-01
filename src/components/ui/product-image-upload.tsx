// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { Loader2, Sparkles, Upload } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CroppableImageUpload } from '@/components/ui/croppable-image-upload';

interface ProductImageUploadProps {
  value?: string | null;
  onChange: (url: string | null) => void;
  userId: string;
  productName?: string;
  categoryName?: string;
  description?: string;
  className?: string;
  beforePick?: () => void | Promise<void>;
}

export function ProductImageUpload({
  value,
  onChange,
  userId,
  productName,
  categoryName,
  description,
  className,
  beforePick,
}: ProductImageUploadProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!productName?.trim()) {
      toast.error('Enter a product name first to generate an image');
      return;
    }

    setIsGenerating(true);
    setPreviewUrl(null);

    try {
      const { data, error } = await supabase.functions.invoke('generate-product-image', {
        body: {
          productName: productName.trim(),
          categoryName: categoryName || null,
          description: description || null,
          userId,
        },
      });

      if (error) throw error;

      if (data?.error) {
        toast.error(data.error);
        return;
      }

      if (data?.image_url) {
        setPreviewUrl(data.image_url);
        toast.success('Image generated! Click "Use This Image" to apply.');
      } else {
        toast.error('No image was generated');
      }
    } catch (err: any) {
      console.error('AI image generation error:', err);
      toast.error(friendlyError(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const applyGenerated = () => {
    if (previewUrl) {
      onChange(previewUrl);
      setPreviewUrl(null);
      toast.success('AI image applied');
    }
  };

  // If already has a value, show the standard upload component (which has change/remove)
  if (value) {
    return (
      <CroppableImageUpload
        value={value}
        onChange={onChange}
        folder="products"
        userId={userId}
        aspectRatio="square"
        placeholder="Upload product photo"
        className={className}
        cropAspect={1}
        beforePick={beforePick}
      />
    );
  }

  return (
    <Tabs defaultValue="upload" className={className}>
      <TabsList className="w-full grid grid-cols-2">
        <TabsTrigger value="upload" className="text-xs gap-1">
          <Upload size={13} />
          Upload
        </TabsTrigger>
        <TabsTrigger value="ai" className="text-xs gap-1">
          <Sparkles size={13} />
          AI Generate
        </TabsTrigger>
      </TabsList>

      <TabsContent value="upload" className="mt-2">
        <CroppableImageUpload
          value={value}
          onChange={onChange}
          folder="products"
          userId={userId}
          aspectRatio="square"
          placeholder="Upload product photo"
          cropAspect={1}
          beforePick={beforePick}
        />
      </TabsContent>

      <TabsContent value="ai" className="mt-2">
        {previewUrl ? (
          <div className="space-y-2">
            <div className="relative h-32 rounded-lg overflow-hidden border border-border bg-muted/20">
              <img src={previewUrl} alt="AI Generated" className="w-full h-full object-contain" />
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" className="flex-1" onClick={applyGenerated}>
                Use This Image
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={handleGenerate} disabled={isGenerating}>
                {isGenerating ? <Loader2 size={14} className="animate-spin" /> : 'Regenerate'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="h-24 rounded-lg border-2 border-dashed border-muted-foreground/25 flex items-center justify-center gap-3 text-muted-foreground px-4">
              {isGenerating ? (
                <>
                  <Loader2 className="animate-spin text-primary flex-shrink-0" size={22} />
                  <div>
                    <span className="text-xs font-medium block">Generating image…</span>
                    <span className="text-[10px]">This may take 10-15 seconds</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={18} className="text-primary" />
                  </div>
                  <div>
                    <span className="text-xs font-medium block">AI Product Image</span>
                    <span className="text-[10px]">Auto-generate a photo from the product name</span>
                  </div>
                </>
              )}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full"
              onClick={handleGenerate}
              disabled={isGenerating || !productName?.trim()}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={14} className="animate-spin mr-1.5" />
                  Generating…
                </>
              ) : (
                <>
                  <Sparkles size={14} className="mr-1.5" />
                  Generate Image
                </>
              )}
            </Button>
            {!productName?.trim() && (
              <p className="text-[10px] text-muted-foreground text-center">
                Enter a product name above first
              </p>
            )}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
