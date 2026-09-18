// @ts-nocheck
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Check, X, Smartphone } from 'lucide-react';
import { format } from 'date-fns';
import type { AdminDirectoryUser, UserDeviceInfo } from '@/hooks/useAdminData';
import { composeUserAddress } from '@/components/admin/admin-user-address';

interface AdminUserDetailSheetProps {
  user: AdminDirectoryUser | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  device?: UserDeviceInfo | null;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
}

function Field({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="text-sm text-foreground break-words">{value}</p>
    </div>
  );
}

export function AdminUserDetailSheet({
  user,
  open,
  onOpenChange,
  device,
  onApprove,
  onReject,
}: AdminUserDetailSheetProps) {
  if (!user) return null;

  const isPending = user.verification_status === 'pending';
  const address = composeUserAddress(user);
  const platforms = device?.platforms?.length
    ? device.platforms.map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(', ')
    : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto w-full sm:max-w-md">
        <SheetHeader className="text-left pr-6">
          <SheetTitle className="text-lg font-extrabold tracking-tight">
            {user.name || 'User'}
          </SheetTitle>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge variant="secondary" className="text-[10px] capitalize rounded-md">
              {user.verification_status || 'unknown'}
            </Badge>
            <Badge
              variant="outline"
              className="text-[10px] rounded-md gap-1"
            >
              <Smartphone size={10} />
              {device?.hasApp ? (platforms || 'App installed') : 'No app push'}
            </Badge>
          </div>
        </SheetHeader>

        <div className="mt-6 space-y-4">
          <Field label="Phone" value={user.phone} />
          <Field label="Email" value={user.email} />
          <Field label="Block / Flat" value={[user.block, user.flat_number].filter(Boolean).join(' · ') || null} />
          <Field label="Phase" value={user.phase} />
          <Field label="Society" value={user.society?.name} />
          <Field label="Society address" value={user.society?.address} />
          <Field
            label="City / State / Pincode"
            value={[user.society?.city, user.society?.state, user.society?.pincode].filter(Boolean).join(', ') || null}
          />
          <Field label="Full address" value={address} />
          <Field
            label="Joined"
            value={user.created_at ? format(new Date(user.created_at), 'PPpp') : null}
          />
          <Field
            label="Updated"
            value={user.updated_at ? format(new Date(user.updated_at), 'PPpp') : null}
          />
          <Field label="App platforms" value={platforms} />
          <Field
            label="Last push activity"
            value={device?.lastSuccessAt ? format(new Date(device.lastSuccessAt), 'PPpp') : null}
          />
          <Field label="User ID" value={user.id} />
        </div>

        {isPending && (onApprove || onReject) ? (
          <div className="mt-8 flex gap-2">
            {onReject && (
              <Button
                variant="outline"
                className="flex-1 rounded-xl text-destructive hover:bg-destructive/10"
                onClick={() => onReject(user.id)}
              >
                <X size={15} className="mr-1.5" /> Reject
              </Button>
            )}
            {onApprove && (
              <Button
                className="flex-1 rounded-xl shadow-sm"
                onClick={() => onApprove(user.id)}
              >
                <Check size={15} className="mr-1.5" /> Approve
              </Button>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
