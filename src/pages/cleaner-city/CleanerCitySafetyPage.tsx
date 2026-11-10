// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  ChevronRight,
  Flag,
  MessageCircle,
  Phone,
  Share2,
  Shield,
  Trash2,
  UserRound,
  UserX,
} from 'lucide-react';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { cc } from '@/components/cleaner-city/ui/ccTheme';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
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
    <CleanerCityChrome
      headerTitle="Safety"
      className={cc.bg}
      backTo="/cleaner-city"
      backLabel="Active trip"
    >
      <CleanerCityGate>
        <div className={cn(cc.page, 'space-y-4')} data-testid="cleaner-city-safety-page">
          <header className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#0F3D2E]">
              Sociva · Cleaner City
            </p>
            <h1 className="text-[28px] font-semibold tracking-tight">Stay safe.</h1>
            <p className="text-[14px] text-muted-foreground">
              We are here if you need support.
            </p>
          </header>

          <button
            type="button"
            className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#8B1E1E] text-[18px] font-semibold text-white active:scale-[0.98]"
            onClick={() =>
              toast.message('SOS is on your active ride', {
                description: 'Open an active trip to send a discreet safety alert.',
              })
            }
          >
            SOS
            <Phone className="h-5 w-5" />
          </button>
          <p className="text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Discreet alert · connects privately
          </p>

          <div
            className={cn(cc.card, 'space-y-2 p-4')}
            data-testid="cleaner-city-sos-explainer-safety"
          >
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <Shield size={16} className="text-[#0F3D2E]" aria-hidden />
              How SOS works
            </p>
            <p className="text-xs text-muted-foreground">
              SOS alerts your emergency contacts and the other rider in the app. If SMS is
              available for your society, phone contacts can also be notified. SOS is not a
              112 dialer. For immediate danger, call 112.
            </p>
          </div>

          <div className={cn(cc.card, 'overflow-hidden')}>
            {[
              {
                to: '/cleaner-city/rides',
                title: 'Call partner',
                blurb: 'Speak with your assigned partner',
                icon: Phone,
              },
              {
                to: '/cleaner-city/chat',
                title: 'Chat',
                blurb: 'Message your partner securely',
                icon: MessageCircle,
              },
              {
                to: '/cleaner-city/rides',
                title: 'Share trip link',
                blurb: 'Let someone follow your trip',
                icon: Share2,
              },
              {
                to: '/cleaner-city/rides',
                title: 'Report a problem',
                blurb: 'We will help right away',
                icon: Flag,
              },
              {
                to: '/cleaner-city/safety',
                title: 'Block partner',
                blurb: 'End contact and prevent messages',
                icon: UserX,
                hash: '#blocks',
              },
              {
                to: '/cleaner-city/safety',
                title: 'Emergency contacts',
                blurb: 'Your trusted contacts',
                icon: UserRound,
                verified: contacts.some((c) => c.verified_at),
                hash: '#contacts',
              },
            ].map((row, idx) => {
              const Icon = row.icon;
              return (
                <Link
                  key={row.title}
                  to={row.hash ? `${row.to}${row.hash}` : row.to}
                  className={cn(
                    'flex items-center gap-3 px-4 py-3.5',
                    idx > 0 && 'border-t border-black/5',
                  )}
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#E8F2EC] text-[#0F3D2E]">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold">{row.title}</p>
                    <p className="text-[12px] text-muted-foreground">{row.blurb}</p>
                  </div>
                  {row.verified ? (
                    <span className="text-[11px] font-semibold text-[#0F3D2E]">Verified</span>
                  ) : null}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </Link>
              );
            })}
          </div>

          <p className="flex items-center justify-center gap-1.5 px-2 text-center text-[12px] text-muted-foreground">
            <Shield className="h-3.5 w-3.5 text-[#0F3D2E]" />
            Your safety is our priority. Every trip. Every step.
          </p>

          <Button
            variant="outline"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onClick={async () => {
              try {
                const res = await dispatchAlerts.mutateAsync(null);
                const failed = res?.failed || 0;
                const sent = res?.sent || 0;
                toast.success(
                  sent
                    ? `Sent ${sent} safety alert${sent === 1 ? '' : 's'}`
                    : failed
                      ? 'Alerts are still queued.'
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
              <div className="rounded-xl border border-amber-500/30 bg-amber-50 p-3 text-xs text-amber-950">
                A phone that is not linked to a Sociva account needs a verification code by
                SMS when messaging is available. This is not a 112 dialer.
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
              Blocked neighbours
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
                  <p className="text-sm font-semibold">Blocked neighbour</p>
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
