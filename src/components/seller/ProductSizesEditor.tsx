import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { sanitizeDecimalInput } from '@/lib/numeric-input';
import { SIZE_LABEL_MAX, type SizeRow } from '@/lib/seller-product-sizes';

interface ProductSizesEditorProps {
  rows: SizeRow[];
  currencySymbol: string;
  error?: string;
  /** Omitted while sizes are switched off: existing sizes stay editable, new ones cannot be added. */
  onAdd?: () => void;
  onChange: (key: string, patch: Partial<SizeRow>) => void;
  onRemove: (key: string) => void;
  onMove: (key: string, delta: -1 | 1) => void;
}

export function ProductSizesEditor({ rows, currencySymbol, error, onAdd, onChange, onRemove, onMove }: ProductSizesEditorProps) {
  return (
    <div id="edit-prod-sizes" className="space-y-3 rounded-xl border border-border p-3">
      <div>
        <Label className="text-sm font-semibold">Sizes (optional)</Label>
        <p className="text-xs text-muted-foreground mt-0.5">
          Sell one item in more than one pack size, each with its own price and stock. Buyers pick a size when they add it to the cart.
        </p>
      </div>

      {rows.map((row, idx) => (
        <div key={row.key} className="rounded-lg bg-muted/40 p-3 space-y-2" data-testid="size-row">
          <div className="flex items-center gap-2">
            <Input
              aria-label={`Size ${idx + 1} name`}
              placeholder="Size name, like 250 g"
              maxLength={SIZE_LABEL_MAX}
              value={row.label}
              onChange={(e) => onChange(row.key, { label: e.target.value })}
            />
            {rows.length > 1 && (
              <div className="flex flex-col">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-8"
                  aria-label={`Move size ${idx + 1} up`}
                  disabled={idx === 0}
                  onClick={() => onMove(row.key, -1)}
                >
                  <ChevronUp size={14} />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-5 w-8"
                  aria-label={`Move size ${idx + 1} down`}
                  disabled={idx === rows.length - 1}
                  onClick={() => onMove(row.key, 1)}
                >
                  <ChevronDown size={14} />
                </Button>
              </div>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove size ${idx + 1}`}
              onClick={() => onRemove(row.key)}
            >
              <Trash2 size={16} className="text-muted-foreground" />
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">Price ({currencySymbol}) *</Label>
              <Input
                aria-label={`Size ${idx + 1} price`}
                inputMode="decimal"
                placeholder="0"
                value={row.price}
                onChange={(e) => onChange(row.key, { price: sanitizeDecimalInput(e.target.value) })}
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">MRP ({currencySymbol})</Label>
              <Input
                aria-label={`Size ${idx + 1} MRP`}
                inputMode="decimal"
                placeholder="Optional"
                value={row.compare_at_price}
                onChange={(e) => onChange(row.key, { compare_at_price: sanitizeDecimalInput(e.target.value) })}
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">Stock</Label>
              <Input
                aria-label={`Size ${idx + 1} stock`}
                inputMode="numeric"
                placeholder="No limit"
                value={row.stock_quantity}
                onChange={(e) => onChange(row.key, { stock_quantity: e.target.value.replace(/[^\d]/g, '') })}
              />
            </div>
          </div>
          <label className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{row.is_active ? 'Buyers can order this size' : 'Shown as not available'}</span>
            <Switch
              aria-label={`Size ${idx + 1} available`}
              checked={row.is_active}
              onCheckedChange={(checked) => onChange(row.key, { is_active: checked })}
            />
          </label>
        </div>
      ))}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {onAdd && (
        <Button type="button" variant="outline" className="w-full" onClick={onAdd}>
          <Plus size={16} className="mr-1.5" />
          {rows.length === 0 ? 'Add sizes' : 'Add another size'}
        </Button>
      )}
    </div>
  );
}
