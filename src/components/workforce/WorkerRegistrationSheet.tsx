// @ts-nocheck
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LiveCameraCapture } from './LiveCameraCapture';
import { useWorkerRegistration, DAYS } from '@/hooks/useWorkerRegistration';

interface WorkerRegistrationSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  categories?: { id: string; name: string; entry_type: string }[];
}

export function WorkerRegistrationSheet({ open, onOpenChange, onSuccess, categories = [] }: WorkerRegistrationSheetProps) {
  const w = useWorkerRegistration(open, onOpenChange, onSuccess, categories);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[90vh] overflow-y-auto">
        <DrawerHeader>
          <DrawerTitle>Register Worker</DrawerTitle>
          <DrawerDescription>Live photo capture is optional. No gallery uploads.</DrawerDescription>
        </DrawerHeader>

        <div className="space-y-4 py-4">
          {/* Live Photo */}
          <div>
            <Label className="mb-2 block">Photo (Live Capture Only)</Label>
            <LiveCameraCapture onCapture={w.handlePhotoCapture} capturedPreview={w.photoPreview} onClear={w.clearPhoto} />
          </div>

          {/* Name & Phone */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Name *</Label>
              <Input value={w.name} onChange={e => w.setName(e.target.value)} placeholder="Worker name" className={w.fieldErrors.name ? 'border-destructive' : ''} />
              {w.fieldErrors.name && <p className="text-xs text-destructive mt-1">{w.fieldErrors.name}</p>}
            </div>
            <div>
              <Label>Phone</Label>
              <Input value={w.phone} onChange={e => w.setPhone(e.target.value)} placeholder="9876543210" inputMode="tel" className={w.fieldErrors.phone ? 'border-destructive' : ''} />
              {w.fieldErrors.phone && <p className="text-xs text-destructive mt-1">{w.fieldErrors.phone}</p>}
            </div>
          </div>

          {/* Preferred Language */}
          <div>
            <Label>Preferred Language *</Label>
            <Select value={w.preferredLanguage} onValueChange={w.setPreferredLanguage}>
              <SelectTrigger><SelectValue placeholder="Select language" /></SelectTrigger>
              <SelectContent>
                {w.languages.length > 0 ? (
                  w.languages.map((lang: any) => <SelectItem key={lang.code} value={lang.code}>{lang.native_name} ({lang.name})</SelectItem>)
                ) : (
                  <SelectItem value="" disabled>No languages configured</SelectItem>
                )}
              </SelectContent>
            </Select>
            {w.languages.length === 0 && <p className="text-xs text-destructive mt-1">⚠️ No languages configured. Contact admin.</p>}
            <p className="text-[10px] text-muted-foreground mt-1">Job summaries will be read in this language</p>
          </div>

          {/* Category / Type */}
          <div className="grid grid-cols-2 gap-3">
            {w.categories.length > 0 ? (
              <div>
                <Label>Category</Label>
                <Select value={w.categoryId || ''} onValueChange={v => w.setCategoryId(v)}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{w.categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ) : (
              <div>
                <Label>Type</Label>
                <p className="text-xs text-destructive mt-1">⚠️ No worker categories configured. Contact admin.</p>
              </div>
            )}
            <div>
              <Label>Entry Frequency *</Label>
              <Select value={w.entryFrequency} onValueChange={w.setEntryFrequency}>
                <SelectTrigger><SelectValue placeholder="Select frequency" /></SelectTrigger>
                <SelectContent>
                  {w.entryFrequencyOptions.length > 0 ? (
                    w.entryFrequencyOptions.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)
                  ) : (
                    <SelectItem value="" disabled>No options configured</SelectItem>
                  )}
                </SelectContent>
              </Select>
              {w.entryFrequencyOptions.length === 0 && <p className="text-xs text-destructive mt-1">⚠️ Entry frequency options not configured. Contact admin.</p>}
            </div>
          </div>

          {/* Shift */}
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Shift Start</Label><Input type="time" value={w.shiftStart} onChange={e => w.setShiftStart(e.target.value)} /></div>
            <div>
              <Label>Shift End</Label>
              <Input type="time" value={w.shiftEnd} onChange={e => w.setShiftEnd(e.target.value)} className={w.fieldErrors.shiftEnd ? 'border-destructive' : ''} />
              {w.fieldErrors.shiftEnd && <p className="text-xs text-destructive mt-1">{w.fieldErrors.shiftEnd}</p>}
            </div>
          </div>

          {/* Active Days */}
          <div>
            <Label className="mb-2 block">Active Days</Label>
            <div className="flex gap-1 flex-wrap">
              {DAYS.map(day => (
                <button key={day} type="button" onClick={() => w.toggleDay(day)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${w.activeDays.includes(day) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}>
                  {day}
                </button>
              ))}
            </div>
          </div>

          {/* Flat Assignments */}
          <div><Label>Assigned Flats (comma separated)</Label><Input value={w.flatNumbers} onChange={e => w.setFlatNumbers(e.target.value)} placeholder="e.g. 301, 402, 505" /></div>

          {/* Emergency Contact */}
          <div>
            <Label>Emergency Contact</Label>
            <Input value={w.emergencyPhone} onChange={e => w.setEmergencyPhone(e.target.value)} placeholder="9876543210" inputMode="tel" className={w.fieldErrors.emergencyPhone ? 'border-destructive' : ''} />
            {w.fieldErrors.emergencyPhone && <p className="text-xs text-destructive mt-1">{w.fieldErrors.emergencyPhone}</p>}
          </div>

          <Button onClick={w.handleSubmit} disabled={w.isSubmitDisabled} className="w-full">
            {w.isSubmitting ? 'Registering...' : 'Register Worker'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
