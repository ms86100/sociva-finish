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
  placeholder?: string;
}

export function ProductImageUpload({
  value,
  onChange,
  userId,
  className,
  beforePick,
  placeholder = 'Upload product photo',
}: ProductImageUploadProps) {
  return (
    <CroppableImageUpload
      value={value}
      onChange={onChange}
      folder="products"
      userId={userId}
      aspectRatio="square"
      placeholder={placeholder}
      className={className}
      cropAspect={1}
      beforePick={beforePick}
    />
  );
}
