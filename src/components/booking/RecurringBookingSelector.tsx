// @ts-nocheck
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { RefreshCw } from 'lucide-react';
import { Calendar as CalendarComponent } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';
import { format, addMonths } from 'date-fns';

export interface RecurringConfig {
  enabled: boolean;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  endDate?: string;
}

interface RecurringBookingSelectorProps {
  config: RecurringConfig;
  onChange: (config: RecurringConfig) => void;
}

export function RecurringBookingSelector({ config, onChange }: RecurringBookingSelectorProps) {
  const endDateObj = config.endDate ? new Date(config.endDate + 'T00:00:00') : undefined;

  return (
    <div className="space-y-3 p-3 border rounded-lg bg-muted/30">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw size={14} className="text-primary" />
          <span className="text-sm font-medium">Repeat this booking</span>
        </div>
        <Switch
          checked={config.enabled}
          onCheckedChange={(checked) => onChange({ ...config, enabled: checked })}
        />
      </div>
      {config.enabled && (
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">Frequency</Label>
            <Select
              value={config.frequency}
              onValueChange={(v) => onChange({ ...config, frequency: v as RecurringConfig['frequency'] })}
            >
              <SelectTrigger className="h-9 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="weekly">Every week</SelectItem>
                <SelectItem value="biweekly">Every 2 weeks</SelectItem>
                <SelectItem value="monthly">Every month</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">End Date <span className="text-muted-foreground">(optional)</span></Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-full h-9 text-xs justify-start gap-2">
                  <Calendar size={12} />
                  {endDateObj ? format(endDateObj, 'MMM d, yyyy') : 'No end date (runs indefinitely)'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <CalendarComponent
                  mode="single"
                  selected={endDateObj}
                  onSelect={(date) => onChange({ ...config, endDate: date ? format(date, 'yyyy-MM-dd') : undefined })}
                  disabled={(date) => date < new Date()}
                  defaultMonth={endDateObj || addMonths(new Date(), 1)}
                />
                {config.endDate && (
                  <div className="p-2 border-t">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => onChange({ ...config, endDate: undefined })}
                    >
                      Clear end date
                    </Button>
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <p className="text-[10px] text-muted-foreground">
            Your recurring preference will be saved. The seller may confirm future slots manually.
          </p>
        </div>
      )}
    </div>
  );
}
