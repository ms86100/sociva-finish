// @ts-nocheck
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LeadTimeUnit } from '@/lib/lead-time';
import { LEAD_TIME_HELP, LEAD_TIME_LABEL } from '@/lib/product-timing-copy';

interface LeadTimeFieldProps {
  value: string;
  unit: LeadTimeUnit;
  onValueChange: (value: string) => void;
  onUnitChange: (unit: LeadTimeUnit) => void;
  className?: string;
  error?: string;
  /** When false, helper text notes lead time only applies with pre-orders */
  preordersEnabled?: boolean;
}

export function LeadTimeField({
  value,
  unit,
  onValueChange,
  onUnitChange,
  className,
  error,
  preordersEnabled = false,
}: LeadTimeFieldProps) {
  return (
    <div className={className}>
      <Label className="text-sm font-semibold">{LEAD_TIME_LABEL}</Label>
      <div className="flex gap-2 mt-1.5">
        <Input
          type="number"
          min="0"
          step={unit === 'minutes' ? '1' : '0.5'}
          placeholder={unit === 'minutes' ? 'e.g. 30' : 'e.g. 2'}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className={`flex-1 ${error ? 'border-destructive' : ''}`}
        />
        <Select value={unit} onValueChange={(v) => onUnitChange(v as LeadTimeUnit)}>
          <SelectTrigger className="w-[120px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="minutes">Minutes</SelectItem>
            <SelectItem value="hours">Hours</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {error ? (
        <p className="text-[10px] text-destructive mt-1">{error}</p>
      ) : (
        <p className="text-[10px] text-muted-foreground mt-1">
          {LEAD_TIME_HELP}
          {!preordersEnabled && ' Turn on Accept Pre-Orders below to use this.'}
        </p>
      )}
    </div>
  );
}
