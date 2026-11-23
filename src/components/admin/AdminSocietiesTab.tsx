import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Search, Sparkles, X } from 'lucide-react';
import { friendlyPackageLabel } from '@/lib/feature-catalog-copy';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { adminNotify } from '@/lib/admin-notify';
import type { Society } from '@/types/Database';
import { SocietyOnboardWizard } from '@/components/admin/SocietyOnboardWizard';
import { decideSocietyMembership, listPendingMemberships, type PendingMembership } from '@/lib/society-membership';

type RegistryRequest = {
  id: string;
  name: string;
  city: string | null;
  pincode: string | null;
  address: string | null;
  contact: string | null;
  status: string;
  created_at: string;
};

type Props = {
  societies: Society[];
  onUpdateStatus: (id: string, isVerified: boolean, isActive: boolean) => void;
  onRefresh: () => void;
};

export function AdminSocietiesTab({ societies, onUpdateStatus, onRefresh }: Props) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'live'>('all');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [seedSocietyId, setSeedSocietyId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMembership[]>([]);
  const [registry, setRegistry] = useState<RegistryRequest[]>([]);
  const [packageBySociety, setPackageBySociety] = useState<Record<string, string>>({});

  useEffect(() => {
    void loadExtras();
  }, [societies.length]);

  const loadExtras = async () => {
    const members = await listPendingMemberships();
    setPending(members);
    const { data: requests } = await supabase
      .from('society_registry_requests' as never)
      .select('id, name, city, pincode, address, contact, status, created_at')
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);
    setRegistry((requests as RegistryRequest[]) || []);

    const { data: links } = await supabase.from('builder_societies').select('society_id, builder_id');
    const { data: assigns } = await supabase
      .from('builder_feature_packages')
      .select('builder_id, package:feature_packages(package_name, name)');
    const pkgByBuilder: Record<string, string> = {};
    for (const row of assigns || []) {
      const pkg = (row as { package?: { package_name?: string | null; name?: string | null } }).package;
      pkgByBuilder[row.builder_id] = pkg?.package_name || pkg?.name || 'Package';
    }
    const map: Record<string, string> = {};
    for (const link of links || []) {
      if (pkgByBuilder[link.builder_id]) map[link.society_id] = pkgByBuilder[link.builder_id];
    }
    setPackageBySociety(map);
  };

  const pendingBySociety = useMemo(() => {
    const map: Record<string, PendingMembership[]> = {};
    for (const row of pending) {
      if (!map[row.society_id]) map[row.society_id] = [];
      map[row.society_id].push(row);
    }
    return map;
  }, [pending]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return societies.filter((soc) => {
      if (filter === 'pending' && soc.is_verified) return false;
      if (filter === 'live' && (!soc.is_verified || !soc.is_active)) return false;
      if (!q) return true;
      return [soc.name, soc.city, soc.pincode, soc.address].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
  }, [societies, query, filter]);

  const openWizard = (id?: string) => {
    setSeedSocietyId(id || null);
    setWizardOpen(true);
  };

  const decideRegistry = async (id: string, status: 'approved' | 'rejected') => {
    const { error } = await supabase
      .from('society_registry_requests' as never)
      .update({ status } as never)
      .eq('id', id);
    if (error) {
      adminNotify.error(error.message);
      return;
    }
    adminNotify.success(status === 'approved' ? 'Marked reviewed - add the society from Add society' : 'Request dismissed');
    await loadExtras();
  };

  const decide = async (membershipId: string, decision: 'active' | 'rejected') => {
    const result = await decideSocietyMembership(membershipId, decision);
    if (!result.ok) {
      adminNotify.error(result.error);
      return;
    }
    adminNotify.success(decision === 'active' ? 'Resident approved' : 'Resident rejected');
    await loadExtras();
    onRefresh();
  };

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-900 p-5 text-white">
        <div className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-emerald-400/20 blur-3xl" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.22em] text-emerald-200/80 font-semibold">Society OS</p>
            <h3 className="text-lg font-bold mt-1">Societies</h3>
            <p className="text-xs text-white/70 mt-1 max-w-[16rem]">
              Approve, attach a builder package, appoint RWA admin, then residents. Maps never prove membership.
            </p>
            <p className="text-[11px] text-emerald-200/90 mt-2 font-medium">
              {filtered.length} shown · {societies.filter((s) => !s.is_verified).length} pending approval
            </p>
          </div>
          <Button size="sm" className="rounded-xl h-9 gap-1.5 font-semibold bg-white text-slate-900 hover:bg-white/90" onClick={() => openWizard()}>
            <Plus size={14} /> Add society
          </Button>
        </div>
      </div>

      {registry.length > 0 && (
        <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
          <CardContent className="p-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resident society requests</p>
            <p className="text-[11px] text-muted-foreground">These are not societies yet. Add them with the wizard after you verify the RWA.</p>
            {registry.slice(0, 6).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 rounded-xl bg-muted/50 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{row.name}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{[row.city, row.pincode, row.contact].filter(Boolean).join(' · ')}</p>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => void decideRegistry(row.id, 'rejected')}>Dismiss</Button>
                  <Button size="sm" className="h-7 px-2 text-[10px] rounded-lg" onClick={() => void decideRegistry(row.id, 'approved')}>Reviewed</Button>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Greenfield, city, pincode"
          className="pl-9 rounded-xl h-10"
        />
      </div>
      <div className="flex gap-1.5">
        {(['all', 'pending', 'live'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setFilter(id)}
            className={cn(
              'px-3 py-1.5 rounded-xl text-[11px] font-semibold capitalize',
              filter === id ? 'bg-primary text-primary-foreground' : 'bg-muted/70 text-muted-foreground',
            )}
          >
            {id}
          </button>
        ))}
      </div>

      {filtered.map((soc) => {
        const waiting = pendingBySociety[soc.id] || [];
        return (
          <motion.div key={soc.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <Card className="border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all duration-300 rounded-2xl">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn('w-3 h-3 rounded-full shrink-0 ring-4', soc.is_verified ? 'bg-emerald-500 ring-emerald-500/20' : 'bg-amber-400 ring-amber-400/20')} />
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate">{soc.name}</p>
                      <p className="text-xs text-muted-foreground">{[soc.city, soc.state, soc.pincode].filter(Boolean).join(', ')}</p>
                      <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                        <Badge variant="secondary" className="text-[10px] h-5 rounded-md font-semibold">{soc.member_count} members</Badge>
                        <Badge variant={soc.is_verified ? 'default' : 'outline'} className="text-[10px] h-5 rounded-md">
                          {soc.is_verified ? 'Verified' : 'Pending'}
                        </Badge>
                        {packageBySociety[soc.id] && (
                          <Badge variant="secondary" className="text-[10px] h-5 rounded-md">{friendlyPackageLabel(packageBySociety[soc.id])}</Badge>
                        )}
                        {waiting.length > 0 && (
                          <Badge className="text-[10px] h-5 rounded-md bg-amber-500/15 text-amber-800 border-0">
                            {waiting.length} waiting
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {!soc.is_verified && (
                      <>
                        <Button size="sm" variant="outline" className="text-destructive h-9 w-9 p-0 rounded-xl" onClick={() => onUpdateStatus(soc.id, false, false)}>
                          <X size={14} />
                        </Button>
                        <Button size="sm" className="h-9 w-9 p-0 rounded-xl" onClick={() => onUpdateStatus(soc.id, true, true)}>
                          <Check size={14} />
                        </Button>
                      </>
                    )}
                    {soc.is_verified && <Switch checked={!!soc.is_active} onCheckedChange={(active) => onUpdateStatus(soc.id, true, active)} />}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-border/30 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[11px] text-muted-foreground font-medium">Invite</span>
                    {soc.invite_code ? (
                      <code className="text-xs bg-muted px-2 py-1 rounded-lg font-mono font-bold tracking-[0.16em]">{soc.invite_code}</code>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] px-3 rounded-lg"
                        onClick={async () => {
                          const code = Math.random().toString(36).substring(2, 8).toUpperCase();
                          await supabase.from('societies').update({ invite_code: code }).eq('id', soc.id);
                          onRefresh();
                          adminNotify.success(`Invite code generated: ${code}`);
                        }}
                      >
                        Generate
                      </Button>
                    )}
                  </div>
                  <Button size="sm" variant="outline" className="h-8 text-[11px] rounded-xl font-semibold gap-1" onClick={() => openWizard(soc.id)}>
                    <Sparkles size={12} /> Manage
                  </Button>
                </div>
                {waiting.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {waiting.slice(0, 4).map((row) => (
                      <div key={row.id} className="flex items-center justify-between rounded-xl bg-muted/50 px-3 py-2">
                        <div>
                          <p className="text-xs font-semibold">{row.name || 'Resident'}</p>
                          <p className="text-[10px] text-muted-foreground">{row.phone}</p>
                        </div>
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-[10px]" onClick={() => void decide(row.id, 'rejected')}>Reject</Button>
                          <Button size="sm" className="h-7 px-2 text-[10px] rounded-lg" onClick={() => void decide(row.id, 'active')}>Approve</Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        );
      })}

      <SocietyOnboardWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        seedSocietyId={seedSocietyId}
        onComplete={() => {
          void loadExtras();
          onRefresh();
        }}
      />
    </div>
  );
}
