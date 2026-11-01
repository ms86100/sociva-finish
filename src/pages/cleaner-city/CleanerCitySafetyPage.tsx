// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Shield, Trash2, UserX } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useDeleteEmergencyContact,
  useEmergencyContacts,
  useListBlocks,
  useUnblockUser,
  useUpsertEmergencyContact,
} from '@/hooks/queries/useCleanerCity';

export default function CleanerCitySafetyPage() {
  const { data: contacts = [], isLoading: contactsLoading } = useEmergencyContacts();
  const { data: blocks = [], isLoading: blocksLoading } = useListBlocks();
  const upsertContact = useUpsertEmergencyContact();
  const deleteContact = useDeleteEmergencyContact();
  const unblockUser = useUnblockUser();

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
      await upsertContact.mutateAsync({
        contact_name: name.trim(),
        phone: phone.trim() || null,
        is_primary: isPrimary,
      });
      toast.success('Emergency contact saved');
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
    <AppLayout headerTitle="Safety">
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
              SOS on an active ride notifies emergency contacts who have a Sociva account and
              the other person on the ride, with a trip share link they can open in the app.
              It is not a 112 dialer - for immediate danger, call 112 directly.
            </p>
          </div>

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
                      ? ' - will be notified in-app'
                      : ' - display only, not a Sociva account yet'}
                  </p>
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
    </AppLayout>
  );
}
