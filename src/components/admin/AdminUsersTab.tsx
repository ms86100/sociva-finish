// @ts-nocheck
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Check, X, Users, Smartphone, Search } from 'lucide-react';
import { format } from 'date-fns';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { AdminDirectoryUser, UserDeviceInfo } from '@/hooks/useAdminData';
import { AdminUserDetailSheet } from '@/components/admin/AdminUserDetailSheet';
import { composeUserAddress, localDateKey, todayLocalKey } from '@/components/admin/admin-user-address';

type UserFilter = 'today' | 'pending' | 'all';

interface AdminUsersTabProps {
  users: AdminDirectoryUser[];
  pendingCount: number;
  userDeviceMap: Record<string, UserDeviceInfo>;
  loading?: boolean;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

const FILTERS: { id: UserFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'pending', label: 'Pending' },
  { id: 'all', label: 'All' },
];

function AppBadge({ device }: { device?: UserDeviceInfo }) {
  if (!device?.hasApp) {
    return (
      <Badge variant="outline" className="text-[10px] rounded-md text-muted-foreground font-medium">
        No app push
      </Badge>
    );
  }
  const label = device.platforms
    .map((p) => (p === 'ios' ? 'iOS' : p === 'android' ? 'Android' : p))
    .join(' · ') || 'App';
  return (
    <Badge className="text-[10px] rounded-md bg-emerald-500/10 text-emerald-700 border-0 gap-1 font-semibold">
      <Smartphone size={10} />
      {label}
    </Badge>
  );
}

export function AdminUsersTab({
  users,
  pendingCount,
  userDeviceMap,
  loading,
  onApprove,
  onReject,
}: AdminUsersTabProps) {
  const [filter, setFilter] = useState<UserFilter>('today');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AdminDirectoryUser | null>(null);

  const todayKey = todayLocalKey();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === 'today' && localDateKey(u.created_at) !== todayKey) return false;
      if (filter === 'pending' && u.verification_status !== 'pending') return false;
      if (!q) return true;
      const hay = [u.name, u.phone, u.email, u.block, u.flat_number, u.society?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [users, filter, query, todayKey]);

  const handleApprove = (id: string) => {
    onApprove(id);
    setSelected((prev) => (prev?.id === id ? null : prev));
  };

  const handleReject = (id: string) => {
    onReject(id);
    setSelected((prev) => (prev?.id === id ? null : prev));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
            <Users size={15} className="text-blue-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-foreground tracking-tight">
              Users
              <span className="text-muted-foreground font-normal ml-1.5 text-xs">({filtered.length})</span>
            </h3>
            {pendingCount > 0 && (
              <p className="text-[10px] text-muted-foreground font-medium">{pendingCount} pending approval</p>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-[11px] font-semibold transition-colors',
              filter === f.id
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'bg-muted/70 text-muted-foreground hover:bg-muted',
            )}
          >
            {f.label}
            {f.id === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or phone…"
          className="pl-9 rounded-xl h-10"
        />
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-sm text-muted-foreground font-medium">
          {filter === 'today' ? 'No users joined today' : filter === 'pending' ? 'No pending users' : 'No users found'}
        </div>
      ) : (
        filtered.map((user, idx) => {
          const device = userDeviceMap[user.id];
          const address = composeUserAddress(user);
          const isPending = user.verification_status === 'pending';
          return (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(idx * 0.02, 0.2) }}
            >
              <Card className="border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all duration-300 rounded-2xl">
                <CardContent className="p-4 flex items-start justify-between gap-2">
                  <button
                    type="button"
                    className="flex items-start gap-3 text-left min-w-0 flex-1"
                    onClick={() => setSelected(user)}
                  >
                    <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Users size={17} className="text-blue-600" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-bold text-sm truncate">{user.name || 'Unnamed'}</p>
                        <Badge variant="secondary" className="text-[9px] capitalize rounded-md shrink-0">
                          {user.verification_status || '—'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{user.phone}</p>
                      {address ? (
                        <p className="text-[11px] text-muted-foreground leading-snug line-clamp-2">{address}</p>
                      ) : null}
                      <div className="flex items-center gap-2 flex-wrap pt-0.5">
                        {user.created_at && (
                          <span className="text-[10px] text-muted-foreground font-medium">
                            Joined {format(new Date(user.created_at), 'dd MMM yyyy, HH:mm')}
                          </span>
                        )}
                        <AppBadge device={device} />
                      </div>
                    </div>
                  </button>
                  {isPending && (
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-destructive h-9 w-9 p-0 rounded-xl hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReject(user.id);
                        }}
                      >
                        <X size={15} />
                      </Button>
                      <Button
                        size="sm"
                        className="h-9 w-9 p-0 rounded-xl shadow-sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleApprove(user.id);
                        }}
                      >
                        <Check size={15} />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </motion.div>
          );
        })
      )}

      <AdminUserDetailSheet
        user={selected}
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        device={selected ? userDeviceMap[selected.id] : null}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
