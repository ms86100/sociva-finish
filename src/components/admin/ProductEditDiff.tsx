// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { useCurrency } from '@/hooks/useCurrency';
import { GitCompareArrows, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProductEditDiffProps {
  productId: string;
  currentProduct: Record<string, any>;
}

interface DiffField {
  label: string;
  oldValue: any;
  newValue: any;
  type: 'text' | 'price' | 'image' | 'json' | 'boolean';
}

export function ProductEditDiff({ productId, currentProduct }: ProductEditDiffProps) {
  const { formatPrice } = useCurrency();
  const [snapshot, setSnapshot] = useState<Record<string, any> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    async function fetchSnapshot() {
      const { data } = await supabase
        .from('product_edit_snapshots')
        .select('snapshot')
        .eq('product_id', productId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      setSnapshot(data?.snapshot || null);
      setIsLoading(false);
    }
    fetchSnapshot();
  }, [productId]);

  if (isLoading || !snapshot) return null;

  const fields: DiffField[] = [
    { label: 'Name', oldValue: snapshot.name, newValue: currentProduct.name, type: 'text' },
    { label: 'Price', oldValue: snapshot.price, newValue: currentProduct.price, type: 'price' },
    { label: 'MRP', oldValue: snapshot.mrp, newValue: currentProduct.mrp, type: 'price' },
    { label: 'Category', oldValue: snapshot.category, newValue: currentProduct.category, type: 'text' },
    { label: 'Description', oldValue: snapshot.description, newValue: currentProduct.description, type: 'text' },
    { label: 'Image', oldValue: snapshot.image_url, newValue: currentProduct.image_url, type: 'image' },
    { label: 'Action Type', oldValue: snapshot.action_type, newValue: currentProduct.action_type, type: 'text' },
    { label: 'Vegetarian', oldValue: snapshot.is_veg, newValue: currentProduct.is_veg, type: 'boolean' },
    { label: 'Bestseller', oldValue: snapshot.is_bestseller, newValue: currentProduct.is_bestseller, type: 'boolean' },
    { label: 'Recommended', oldValue: snapshot.is_recommended, newValue: currentProduct.is_recommended, type: 'boolean' },
    { label: 'Urgent Order', oldValue: snapshot.is_urgent, newValue: currentProduct.is_urgent, type: 'boolean' },
    { label: 'Available', oldValue: snapshot.is_available, newValue: currentProduct.is_available, type: 'boolean' },
    { label: 'Stock Qty', oldValue: snapshot.stock_quantity, newValue: currentProduct.stock_quantity, type: 'text' },
    { label: 'Low Stock Threshold', oldValue: snapshot.low_stock_threshold, newValue: currentProduct.low_stock_threshold, type: 'text' },
    { label: 'Prep Time (min)', oldValue: snapshot.prep_time_minutes, newValue: currentProduct.prep_time_minutes, type: 'text' },
    { label: 'Lead Time (hrs)', oldValue: snapshot.lead_time_hours, newValue: currentProduct.lead_time_hours, type: 'text' },
    { label: 'Pre-orders', oldValue: snapshot.accepts_preorders, newValue: currentProduct.accepts_preorders, type: 'boolean' },
    { label: 'Contact Phone', oldValue: snapshot.contact_phone, newValue: currentProduct.contact_phone, type: 'text' },
    { label: 'Attributes', oldValue: snapshot.specifications, newValue: currentProduct.specifications, type: 'json' },
  ];

  const changedFields = fields.filter(f => {
    if (f.type === 'json') return JSON.stringify(f.oldValue ?? null) !== JSON.stringify(f.newValue ?? null);
    // Normalize nullish for comparison
    const a = f.oldValue ?? null;
    const b = f.newValue ?? null;
    return a !== b;
  });

  if (changedFields.length === 0) return null;

  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded-xl bg-amber-50/50 dark:bg-amber-950/20 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors"
      >
        <GitCompareArrows size={14} className="text-amber-600 shrink-0" />
        <span className="text-xs font-bold text-amber-700 dark:text-amber-400">
          {changedFields.length} field{changedFields.length > 1 ? 's' : ''} changed
        </span>
        {expanded ? <ChevronUp size={14} className="ml-auto text-amber-500" /> : <ChevronDown size={14} className="ml-auto text-amber-500" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5">
          {changedFields.map((field) => (
            <div key={field.label} className="space-y-1">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">{field.label}</p>
              <div className="grid grid-cols-2 gap-2">
                <DiffValue label="Before" value={field.oldValue} type={field.type} formatPrice={formatPrice} variant="old" />
                <DiffValue label="Now" value={field.newValue} type={field.type} formatPrice={formatPrice} variant="new" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffValue({ label, value, type, formatPrice, variant }: {
  label: string;
  value: any;
  type: string;
  formatPrice: (n: number) => string;
  variant: 'old' | 'new';
}) {
  const bgClass = variant === 'old'
    ? 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'
    : 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800';
  const textClass = variant === 'old' ? 'text-red-700 dark:text-red-400' : 'text-green-700 dark:text-green-400';

  return (
    <div className={cn('rounded-lg border p-2', bgClass)}>
      <p className={cn('text-[9px] font-semibold uppercase mb-0.5', textClass)}>{label}</p>
      {type === 'image' ? (
        value ? (
          <img src={value} alt={label} className="w-10 h-10 rounded-md object-cover" />
        ) : (
          <span className="text-xs text-muted-foreground italic">No image</span>
        )
      ) : type === 'price' ? (
        <p className="text-xs font-bold">{value != null ? formatPrice(value) : '—'}</p>
      ) : type === 'boolean' ? (
        <Badge variant={value ? 'default' : 'secondary'} className="text-[10px]">{value ? 'Yes' : 'No'}</Badge>
      ) : type === 'json' ? (
        <p className="text-[10px] text-muted-foreground break-all line-clamp-3">
          {value ? JSON.stringify(value, null, 1) : '—'}
        </p>
      ) : (
        <p className="text-xs break-words line-clamp-3">{value ?? <span className="text-muted-foreground italic">Empty</span>}</p>
      )}
    </div>
  );
}
