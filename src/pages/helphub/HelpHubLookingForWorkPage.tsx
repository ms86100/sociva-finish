// @ts-nocheck
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { HelpHubGate } from '@/components/helphub/HelpHubGate';
import { ChipPicker } from '@/components/helphub/ChipPicker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  HELPHUB_AVAILABILITY,
  HELPHUB_AVAILABILITY_DEFAULT_HOURS,
  HELPHUB_CATEGORIES,
  HELPHUB_CONSENT_TEXT,
  HELPHUB_WORK_TYPES,
  normalizeHelpHubPhone,
  normalizeHelpHubTime,
} from '@/lib/helphub/constants';
import type { HelpHubAvailability } from '@/lib/helphub/types';
import { useCreateHelpHubListing } from '@/hooks/queries/useHelpHub';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export default function HelpHubLookingForWorkPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const createListing = useCreateHelpHubListing();
  const [assisted, setAssisted] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [category, setCategory] = useState('maid');
  const [workType, setWorkType] = useState('part_time');
  const [availability, setAvailability] = useState<HelpHubAvailability>('flexible');
  const [availableFrom, setAvailableFrom] = useState('');
  const [availableTo, setAvailableTo] = useState('');
  const [experience, setExperience] = useState('');
  const [description, setDescription] = useState('');
  const [salary, setSalary] = useState('');
  const [consent, setConsent] = useState(false);

  const onAvailabilityChange = (value: string) => {
    const next = value as HelpHubAvailability;
    setAvailability(next);
    const suggested = HELPHUB_AVAILABILITY_DEFAULT_HOURS[next];
    if (suggested) {
      setAvailableFrom(suggested.from);
      setAvailableTo(suggested.to);
    } else {
      setAvailableFrom('');
      setAvailableTo('');
    }
  };

  const onPublish = async () => {
    if (!displayName.trim()) {
      toast.error('Please enter a name');
      return;
    }
    const normalizedPhone = normalizeHelpHubPhone(phone);
    if (!phone.trim()) {
      toast.error('Please enter a phone number');
      return;
    }
    if (!normalizedPhone) {
      toast.error('Enter a valid 10-digit mobile number');
      return;
    }
    const from = normalizeHelpHubTime(availableFrom);
    const to = normalizeHelpHubTime(availableTo);
    if ((availableFrom && !from) || (availableTo && !to)) {
      toast.error('Enter valid times like 07:00');
      return;
    }
    if (from && to && from === to) {
      toast.error('End time should be different from start time');
      return;
    }
    if ((from && !to) || (!from && to)) {
      toast.error('Add both From and To times, or leave both blank');
      return;
    }
    if (!consent) {
      toast.error('Consent is required before publishing');
      return;
    }
    try {
      const listing = await createListing.mutateAsync({
        display_name: displayName.trim(),
        category,
        work_type: workType,
        availability,
        available_from: from || undefined,
        available_to: to || undefined,
        description: description.trim() || undefined,
        expected_salary: salary ? Number(salary) : undefined,
        experience_years: experience ? Number(experience) : undefined,
        private_phone: normalizedPhone,
        recommender_flat: assisted ? (profile?.flat_number || undefined) : undefined,
        source: assisted ? 'assisted' : 'self_registered',
        consent_confirmed: true,
        preferred_area: 'Within society',
        tower_or_block: profile?.block || undefined,
      });
      toast.success('Profile published on HelpHub');
      navigate(`/help-hub/listing/${listing.id}`);
    } catch (err: any) {
      toast.error(err?.message || 'Could not publish');
    }
  };

  return (
    <AppLayout headerTitle="Looking for Work">
      <HelpHubGate>
        <div className="p-4 pb-40 space-y-5">
          <div>
            <h1 className="text-lg font-bold">Looking for Work</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Register availability. Society members can call after you publish.
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-border p-3">
            <Checkbox
              checked={assisted}
              onCheckedChange={(v) => setAssisted(v === true)}
              className="mt-0.5"
            />
            <span className="text-xs leading-relaxed">
              Assisted registration - I am a resident helping someone who may not use the app.
              Their consent is still required.
            </span>
          </label>

          <section className="space-y-2">
            <Label className="text-xs font-semibold">Job category</Label>
            <ChipPicker options={HELPHUB_CATEGORIES} value={category} onChange={setCategory} />
          </section>

          <section className="space-y-2">
            <Label className="text-xs font-semibold">Work type</Label>
            <ChipPicker options={HELPHUB_WORK_TYPES} value={workType} onChange={setWorkType} />
          </section>

          <section className="space-y-2">
            <Label className="text-xs font-semibold">Availability</Label>
            <ChipPicker
              options={HELPHUB_AVAILABILITY}
              value={availability}
              onChange={onAvailabilityChange}
            />
            <div className="rounded-2xl border border-border/80 bg-muted/20 p-3 space-y-2">
              <p className="text-[11px] font-semibold text-foreground">
                Typical hours <span className="font-normal text-muted-foreground">(optional)</span>
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="hh-work-from" className="text-[11px] text-muted-foreground">
                    From
                  </Label>
                  <Input
                    id="hh-work-from"
                    type="time"
                    value={availableFrom}
                    onChange={(e) => setAvailableFrom(e.target.value)}
                    className="rounded-xl"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="hh-work-to" className="text-[11px] text-muted-foreground">
                    To
                  </Label>
                  <Input
                    id="hh-work-to"
                    type="time"
                    value={availableTo}
                    onChange={(e) => setAvailableTo(e.target.value)}
                    className="rounded-xl"
                  />
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                Set the usual window, e.g. 8:00 AM - 1:00 PM. Leave blank if timing varies.
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <Label htmlFor="hh-work-name" className="text-xs font-semibold">
              Name or preferred display name
            </Label>
            <Input
              id="hh-work-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={80}
            />
          </section>

          <section className="space-y-2">
            <Label htmlFor="hh-work-phone" className="text-xs font-semibold">
              Phone number
            </Label>
            <Input
              id="hh-work-phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="10-digit mobile number"
              maxLength={14}
            />
            <p className="text-[11px] text-muted-foreground">
              Used for Contact calls by society members. Publish only if you agree to receive calls.
            </p>
          </section>

          <section className="space-y-2">
            <Label htmlFor="hh-exp" className="text-xs font-semibold">
              Experience in years (optional)
            </Label>
            <Input
              id="hh-exp"
              type="number"
              inputMode="numeric"
              value={experience}
              onChange={(e) => setExperience(e.target.value)}
            />
          </section>

          <section className="space-y-2">
            <Label htmlFor="hh-work-salary" className="text-xs font-semibold">
              Expected salary (optional)
            </Label>
            <Input
              id="hh-work-salary"
              type="number"
              inputMode="numeric"
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
            />
          </section>

          <section className="space-y-2">
            <Label htmlFor="hh-work-desc" className="text-xs font-semibold">
              Short description (optional)
            </Label>
            <Textarea
              id="hh-work-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={400}
            />
          </section>

          <label className="flex items-start gap-3 rounded-2xl border border-border p-3">
            <Checkbox
              checked={consent}
              onCheckedChange={(v) => setConsent(v === true)}
              className="mt-0.5"
            />
            <span className="text-xs leading-relaxed">{HELPHUB_CONSENT_TEXT}</span>
          </label>

          <Button
            className="w-full rounded-xl h-11"
            disabled={createListing.isPending}
            onClick={onPublish}
          >
            {createListing.isPending ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" /> Publishing...
              </>
            ) : (
              'Publish profile'
            )}
          </Button>
        </div>
      </HelpHubGate>
    </AppLayout>
  );
}
