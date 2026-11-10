// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Shield, Trash2, UserX } from 'lucide-react';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import {
  useConfirmContactVerification,
  useDeleteEmergencyContact,
  useDispatchSafetyAlerts,
  useEmergencyContacts,
  useListBlocks,
  useStartContactVerification,
  useUnblockUser,
  useUpsertEmergencyContact,
} from '@/hooks/queries/useCleanerCity';

export default function CleanerCitySafetyPage() {
  const { data: contacts = [], isLoading: contactsLoading } = useEmergencyContacts();
  const { data: blocks = [], isLoading: blocksLoading } = useListBlocks();
  const upsertContact = useUpsertEmergencyContact();
  const deleteContact = useDeleteEmergencyContact();
  const unblockUser = useUnblockUser();
  const startVerify = useStartContactVerification();
  const confirmVerify = useConfirmContactVerification();
  const dispatchAlerts = useDispatchSafetyAlerts();
  const [verifyCode, setVerifyCode] = useState<Record<string, string>>({});

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [isPrimary, setIsPrimary] = useState(false);

  const canAddMore = contacts.length < 3;

  const addContact = async () => {
    if (!name.trim()) {
      toast.error('Contact name is required');
      return;
    }
    try {
      let notifyUserId: string | null = null;
      if (phone.trim()) {
        const { data: resolved, error: resolveError } = await supabase.rpc(
          'cleaner_city_resolve_emergency_notify_user',
          { p_phone: phone.trim() },
        );
        if (resolveError) throw resolveError;
        notifyUserId = resolved || null;
      }
      await upsertContact.mutateAsync({
        contact_name: name.trim(),
        phone: phone.trim() || null,
        notify_user_id: notifyUserId,
        is_primary: isPrimary,
      });
      if (notifyUserId) {
        toast.success('Contact linked to a Sociva account - they can get in-app SOS alerts');
      } else if (phone.trim()) {
        toast.success(
          'Contact saved. Phone-only contacts can be verified with a code. SMS sends when the SMS template is configured.',
        );
      } else {
        toast.success('Emergency contact saved');
      }
      setName('');
      setPhone('');
      setIsPrimary(false);
    } catch (e: any) {
      toast.error(e?.message || 'Could not save contact');
    }
  };

  const removeContact = async (contactId: string) => {
    try {
      await deleteContact.mutateAsync(contactId);
      toast.success('Contact removed');
    } catch (e: any) {
      toast.error(e?.message || 'Could not remove contact');
    }
  };

  const unblock = async (blockedUserId: string) => {
    try {
      await unblockUser.mutateAsync(blockedUserId);
      toast.success('User unblocked');
    } catch (e: any) {
      toast.error(e?.message || 'Could not unblock');
    }
  };

  return (
    <CleanerCityChrome headerTitle="Safety">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-safety-page">
          <div>
            <h1 className="text-xl font-bold text-foreground">Safety</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Emergency contacts and blocked riders for A Cleaner City.
            </p>
          </div>

          <div
            className="rounded-2xl border border-border bg-card p-4 space-y-2"
            data-testid="cleaner-city-sos-explainer-safety"
          >
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <Shield size={16} className="text-primary" aria-hidden />
              How SOS works
            </p>
            <p className="text-xs text-muted-foreground">
            SOS records an incident and sends in-app alerts to linked Sociva contacts, the
            other rider, and society admins when available. Phone contacts are also queued
            for SMS. SMS is delivered only when Sociva's SMS template is configured, and a
            failed send can be retried. It is not a 112 dialer. Add a phone that already
            belongs to a Sociva neighbour to link them, or verify a phone with a code.
            For immediate danger, call 112.
            </p>
          </div>

          <Button
            variant="outline"
            onClick={async () => {
              try {
                const res = await dispatchAlerts.mutateAsync(null);
                const failed = res?.failed || 0;
                const sent = res?.sent || 0;
                toast.success(
                  sent
                    ? `Sent ${sent} safety alert${sent === 1 ? '' : 's'}`
                    : failed
                      ? 'Alerts are still queued. SMS or calling is not configured yet.'
                      : 'No pending safety alerts',
                );
              } catch (e: any) {
                toast.error(e?.message || 'Could not retry safety alerts');
              }
            }}
            data-testid="cleaner-city-retry-safety-alerts"
          >
            Retry undelivered safety alerts
          </Button>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">Emergency contacts</p>
              <span className="text-[11px] text-muted-foreground">{contacts.length}/3</span>
            </div>
            {contactsLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
            {!contactsLoading && contacts.length === 0 && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="cleaner-city-emergency-contacts-empty"
              >
                No emergency contacts yet. Add up to 3 people who should be notified during an
                SOS.
              </p>
            )}
            {contacts.some((c) => c.phone && !c.verified_at) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                A phone that is not a Sociva account needs an SMS code. That SMS needs an MSG91 SOS template in admin settings. If SMS fails, WhatsApp is tried next when WhatsApp is configured. This is not a 112 call.
              </div>
            )}
            {contacts.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between gap-2 rounded-xl border border-border p-3"
                data-testid="cleaner-city-emergency-contact-row"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">
                    {c.contact_name}
                    {c.is_primary && (
                      <span className="ml-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Primary
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {c.phone || 'No phone on file'}
                    {c.notify_user_id
                      ? ' - linked Sociva account'
                      : c.verified_at
                        ? ' - phone verified'
                        : ' - not verified yet'}
                  </p>
                  {!c.verified_at && c.phone && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            const res = await startVerify.mutateAsync(c.id);
                            toast.success(
                              res?.verified
                                ? 'Contact verified through their Sociva account'
                                : 'Verification SMS queued. It sends when the SMS template is configured.',
                            );
                          } catch (e: any) {
                            toast.error(e?.message || 'Could not start verification');
                          }
                        }}
                      >
                        Send code
                      </Button>
                      <Input
                        className="h-8 w-24"
                        placeholder="Code"
                        value={verifyCode[c.id] || ''}
                        onChange={(e) => setVerifyCode((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      />
                      <Button
                        size="sm"
                        onClick={async () => {
                          try {
                            await confirmVerify.mutateAsync({ contact_id: c.id, code: verifyCode[c.id] || '' });
                            toast.success('Contact verified');
                          } catch (e: any) {
                            toast.error(e?.message || 'Code did not match');
                          }
                        }}
                      >
                        Confirm
                      </Button>
                    </div>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive shrink-0"
                  onClick={() => removeContact(c.id)}
                  disabled={deleteContact.isPending}
                >
                  <Trash2 size={14} aria-hidden />
                </Button>
              </div>
            ))}

            {canAddMore ? (
              <div className="pt-2 border-t border-border space-y-2">
                <div>
                  <Label>Name</Label>
                  <Input
                    placeholder="Contact name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="cleaner-city-emergency-contact-name"
                  />
                </div>
                <div>
                  <Label>Phone (optional)</Label>
                  <Input
                    placeholder="For display only - not auto-dialed"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    data-testid="cleaner-city-emergency-contact-phone"
                  />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={isPrimary}
                    onChange={(e) => setIsPrimary(e.target.checked)}
                  />
                  Make this my primary contact
                </label>
                <Button
                  onClick={addContact}
                  disabled={upsertContact.isPending || !name.trim()}
                  data-testid="cleaner-city-emergency-contact-add"
                >
                  Add contact
                </Button>
                <p className="text-[11px] text-muted-foreground">
                  Contacts with Sociva accounts get notified in-app during an SOS. Phone-only
                  contacts are kept for your own reference - we never auto-dial.
                </p>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Maximum of 3 emergency contacts reached. Remove one to add another.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold flex items-center gap-1.5">
              <UserX size={16} className="text-destructive" aria-hidden />
              Blocked riders
            </p>
            {blocksLoading && <p className="text-xs text-muted-foreground">Loading...</p>}
            {!blocksLoading && blocks.length === 0 && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="cleaner-city-blocks-empty"
              >
                You have not blocked anyone.
              </p>
            )}
            {blocks.map((b) => (
              <div
                key={b.blocked_user_id}
                className="flex items-center justify-between gap-2 rounded-xl border border-border p-3"
                data-testid="cleaner-city-block-row"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold">Blocked rider</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {b.reason || 'No reason given'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => unblock(b.blocked_user_id)}
                  disabled={unblockUser.isPending}
                  data-testid="cleaner-city-unblock-button"
                >
                  Unblock
                </Button>
              </div>
            ))}
          </div>

          <Link to="/cleaner-city" className="text-sm font-semibold text-primary block text-center">
            Back to A Cleaner City
          </Link>
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
