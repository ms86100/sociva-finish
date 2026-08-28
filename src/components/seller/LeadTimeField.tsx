// @ts-nocheck
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { LeadTimeUnit } from '@/lib/lead-time';

interface LeadTimeFieldProps {
  value: string;
  unit: LeadTimeUnit;
  onValueChange: (value: string) => void;
  onUnitChange: (unit: LeadTimeUnit) => void;
  className?: string;
}

export function LeadTimeField({ value, unit, onValueChange, onUnitChange, className }: LeadTimeFieldProps) {
  return (
    <div className={className}>
      <Label className="text-sm font-semibold">Order lead time</Label>
      <div className="flex gap-2 mt-1.5">
        <Input
          type="number"
          min="0"
          placeholder={unit === 'minutes' ? 'e.g. 30' : 'e.g. 2'}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          className="flex-1"
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
      <p className="text-[10px] text-muted-foreground mt-1">Minimum advance notice buyers need before ordering</p>
    </div>
  );
}
