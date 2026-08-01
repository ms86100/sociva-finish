// @ts-nocheck
import { useMemo } from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useActionTypeMap, useCategoryAllowedActions, getCheckoutModeDescription } from '@/hooks/useActionTypeMap';
import { ShoppingCart, Calendar, MessageCircle, Phone } from 'lucide-react';

const CHECKOUT_ICONS: Record<string, typeof ShoppingCart> = {
  cart: ShoppingCart,
  booking: Calendar,
  inquiry: MessageCircle,
  contact: Phone,
};

interface ActionTypeSelectorProps {
  category: string;
  value: string;
  onChange: (value: string) => void;
  configs: any[];
}

export function ActionTypeSelector({ category, value, onChange, configs }: ActionTypeSelectorProps) {
  const { data: allActions = [] } = useActionTypeMap();
  const categoryConfig = configs.find((c: any) => c.category === category);
  const categoryConfigId = categoryConfig?.id ?? null;
  const { data: allowedList } = useCategoryAllowedActions(categoryConfigId);

  const options = useMemo(() => {
    if (!allActions.length) return [];
    if (allowedList && allowedList.length > 0) {
      return allActions.filter(a => allowedList.includes(a.action_type));
    }
    return allActions;
  }, [allActions, allowedList]);

  const selected = allActions.find(a => a.action_type === value);
  const Icon = selected ? CHECKOUT_ICONS[selected.checkout_mode] || ShoppingCart : ShoppingCart;

  return (
    <div className="space-y-2">
      <Label className="text-xs">Buyer Interaction</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10">
          <SelectValue placeholder="Choose how buyers interact" />
        </SelectTrigger>
        <SelectContent>
          {options.map(opt => {
            const OptIcon = CHECKOUT_ICONS[opt.checkout_mode] || ShoppingCart;
            return (
              <SelectItem key={opt.action_type} value={opt.action_type}>
                <span className="flex items-center gap-2">
                  <OptIcon size={14} className="text-muted-foreground shrink-0" />
                  <span>{opt.cta_label}</span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {selected && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 border border-border">
          <Icon size={14} className="text-primary shrink-0" />
          <span className="text-xs text-muted-foreground">{getCheckoutModeDescription(selected.checkout_mode)}</span>
          <Badge variant="outline" className="ml-auto text-[10px] h-5">{selected.cta_short_label}</Badge>
        </div>
      )}
      <p className="text-[10px] text-muted-foreground">You can set different interaction types for each product</p>
    </div>
  );
}
