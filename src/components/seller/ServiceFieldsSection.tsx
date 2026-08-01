// @ts-nocheck
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Clock, MapPin, Users } from 'lucide-react';

export interface ServiceFieldsData {
  service_type: string;
  location_type: string;
  duration_minutes: string;
  buffer_minutes: string;
  max_bookings_per_slot: string;
  cancellation_notice_hours: string;
  rescheduling_notice_hours: string;
  preparation_instructions: string;
}

export const INITIAL_SERVICE_FIELDS: ServiceFieldsData = {
  service_type: 'scheduled',
  location_type: 'at_seller',
  duration_minutes: '60',
  buffer_minutes: '15',
  max_bookings_per_slot: '1',
  cancellation_notice_hours: '24',
  rescheduling_notice_hours: '12',
  preparation_instructions: '',
};

interface ServiceFieldsSectionProps {
  data: ServiceFieldsData;
  onChange: (data: ServiceFieldsData) => void;
  errors?: Record<string, string>;
}

export function ServiceFieldsSection({ data, onChange, errors = {} }: ServiceFieldsSectionProps) {
  const update = (field: keyof ServiceFieldsData, value: string) => onChange({ ...data, [field]: value });

  return (
    <div className="space-y-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
      <p className="text-xs font-semibold text-primary uppercase tracking-wide flex items-center gap-1.5"><Clock size={12} /> Service Configuration</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1" id="edit-prod-service_type">
          <Label className="text-xs">Service Type *</Label>
          <Select value={data.service_type} onValueChange={(v) => update('service_type', v)}>
            <SelectTrigger className={`h-9 text-xs ${errors.service_type ? 'border-destructive' : ''}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="scheduled">Scheduled</SelectItem>
              <SelectItem value="on_demand">On Demand</SelectItem>
              <SelectItem value="group">Group / Class</SelectItem>
              <SelectItem value="recurring">Recurring</SelectItem>
            </SelectContent>
          </Select>
          {errors.service_type && <p className="text-xs text-destructive">{errors.service_type}</p>}
        </div>
        <div className="space-y-1" id="edit-prod-location_type">
          <Label className="text-xs flex items-center gap-1"><MapPin size={10} />Location *</Label>
          <Select value={data.location_type} onValueChange={(v) => update('location_type', v)}>
            <SelectTrigger className={`h-9 text-xs ${errors.location_type ? 'border-destructive' : ''}`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="at_seller">At Seller Location</SelectItem>
              <SelectItem value="at_store">At Store Location</SelectItem>
              <SelectItem value="home_visit">Home Visit</SelectItem>
              <SelectItem value="online">Online</SelectItem>
            </SelectContent>
          </Select>
          {errors.location_type && <p className="text-xs text-destructive">{errors.location_type}</p>}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="space-y-1" id="edit-prod-duration_minutes">
          <Label className="text-xs">Duration (min) *</Label>
          <Input type="number" min="5" value={data.duration_minutes} onChange={(e) => update('duration_minutes', e.target.value)} className={`h-9 text-xs ${errors.duration_minutes ? 'border-destructive' : ''}`} />
          {errors.duration_minutes && <p className="text-xs text-destructive">{errors.duration_minutes}</p>}
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Buffer (min)</Label>
          <Input type="number" min="0" value={data.buffer_minutes} onChange={(e) => update('buffer_minutes', e.target.value)} className="h-9 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs flex items-center gap-1"><Users size={10} />Max/Slot</Label>
          <Input type="number" min="1" value={data.max_bookings_per_slot} onChange={(e) => update('max_bookings_per_slot', e.target.value)} className="h-9 text-xs" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Cancel Notice (hrs)</Label>
          <Input type="number" min="0" value={data.cancellation_notice_hours} onChange={(e) => update('cancellation_notice_hours', e.target.value)} className="h-9 text-xs" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Reschedule Notice (hrs)</Label>
          <Input type="number" min="0" value={data.rescheduling_notice_hours} onChange={(e) => update('rescheduling_notice_hours', e.target.value)} className="h-9 text-xs" />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Preparation Instructions (optional)</Label>
        <textarea placeholder="e.g. Bring a yoga mat, wear comfortable clothing..." value={data.preparation_instructions} onChange={(e) => update('preparation_instructions', e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-xs ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring min-h-[60px] resize-y" />
      </div>
    </div>
  );
}
