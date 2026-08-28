// @ts-nocheck
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
  className,
  beforePick,
}: ProductImageUploadProps) {
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
