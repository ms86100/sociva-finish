// @ts-nocheck
import { useState } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { SocietySwitcher } from '@/components/admin/SocietySwitcher';
import { SecurityStaffManager } from '@/components/admin/SecurityStaffManager';
import { SecurityModeSettings } from '@/components/admin/SecurityModeSettings';
import { CommitteeDashboard } from '@/components/admin/CommitteeDashboard';
import { AdminDisputesTab } from '@/components/admin/AdminDisputesTab';
import { AdminPaymentMilestones } from '@/components/admin/AdminPaymentMilestones';
import { useSocietyAdmin } from '@/hooks/useSocietyAdmin';
import { Check, X, Users, Store, Settings, Shield, UserPlus, Trash2, ToggleLeft, Lock, IndianRupee, LayoutDashboard, AlertCircle, MoreHorizontal } from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { FeatureKey } from '@/hooks/useEffectiveFeatures';

function StatCard({ icon: Icon, value, label, color, delay = 0 }: { icon: any; value: string | number; label: string; color: string; delay?: number }) {
  return (
    <motion.div initial={{ opacity: 0, y: 16, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, delay }}>
      <Card className="border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all duration-300 rounded-2xl group">
        <CardContent className="p-3.5 flex items-center gap-3">
          <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center shrink-0 transition-transform duration-300 group-hover:scale-110', color)}>
            <Icon size={17} className="text-white" />
          </div>
          <div>
            <p className="text-xl font-extrabold tabular-nums leading-tight tracking-tight">{value}</p>
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest">{label}</p>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default function SocietyAdminPage() {
  const sa = useSocietyAdmin();
  const [rejectingSellerId, setRejectingSellerId] = useState<string | null>(null);
  const [sellerRejectionNote, setSellerRejectionNote] = useState('');

  if (!sa.isSocietyAdmin && !sa.isAdmin) {
    return (
      <AppLayout headerTitle="Society Admin" showLocation={false}>
        <div className="p-4 text-center py-24">
          <div className="w-16 h-16 rounded-2xl bg-muted mx-auto mb-4 flex items-center justify-center">
            <Shield size={28} className="text-muted-foreground/40" />
          </div>
          <p className="font-bold text-foreground text-lg">Access Denied</p>
          <p className="text-sm text-muted-foreground mt-1">You need society admin privileges.</p>
        </div>
      </AppLayout>
    );
  }

  if (sa.isLoading) return (
    <AppLayout headerTitle="Society Admin" showLocation={false}>
      <div className="p-4 space-y-5">
        <Skeleton className="h-14 w-56 rounded-2xl" />
        <div className="grid grid-cols-3 gap-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-[76px] w-full rounded-2xl" />)}</div>
      </div>
    </AppLayout>
  );

  const TAB_CONFIG = [
    { value: 'overview', label: 'Overview', icon: LayoutDashboard },
    { value: 'users', label: 'Users', icon: Users },
    { value: 'sellers', label: 'Sellers', icon: Store },
    { value: 'disputes', label: 'Disputes', icon: AlertCircle },
    { value: 'more', label: 'More', icon: MoreHorizontal },
  ];

  return (
    <AppLayout headerTitle={`${sa.effectiveSociety?.name || 'Society'} Admin`} showLocation={false}>
      <div className="pb-8">
        <div className="px-4 pt-5 pb-4">
          {sa.isAdmin && <SocietySwitcher />}
        </div>

        {/* Stats */}
        <div className="px-4 mb-6">
          <div className="grid grid-cols-3 gap-3">
            <StatCard icon={Users} value={sa.pendingUsers.length} label="Pending" color="bg-blue-500" delay={0} />
            <StatCard icon={Store} value={sa.pendingSellers.length} label="Sellers" color="bg-amber-500" delay={0.05} />
            <StatCard icon={Shield} value={sa.societyAdmins.length} label="Admins" color="bg-violet-500" delay={0.1} />
          </div>
        </div>

        <div className="px-4">
          <Tabs defaultValue="overview">
            <div className="overflow-x-auto scrollbar-hide -mx-4 px-4 pb-2">
              <TabsList className="inline-flex w-auto gap-0.5 bg-muted/60 p-1 rounded-2xl backdrop-blur-sm">
                {TAB_CONFIG.map(tab => {
                  const TabIcon = tab.icon;
                  return (
                    <TabsTrigger key={tab.value} value={tab.value} className="text-[11px] px-3 py-2 rounded-xl whitespace-nowrap gap-1.5 data-[state=active]:bg-background data-[state=active]:shadow-[var(--shadow-sm)] data-[state=active]:font-semibold transition-all duration-200">
                      <TabIcon size={12} />
                      {tab.label}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>

            <TabsContent value="overview" className="mt-5">
              {sa.societyId && <CommitteeDashboard societyId={sa.societyId} />}
            </TabsContent>

            <TabsContent value="users" className="space-y-3 mt-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                  <Users size={15} className="text-blue-600" />
                </div>
                <h3 className="text-sm font-bold">Pending Users <span className="text-muted-foreground font-normal text-xs">({sa.pendingUsers.length})</span></h3>
              </div>
              {sa.pendingUsers.length > 0 ? sa.pendingUsers.map(user => (
                <Card key={user.id} className="border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all duration-300 rounded-2xl">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-xl bg-blue-500/10 flex items-center justify-center">
                        <Users size={17} className="text-blue-600" />
                      </div>
                      <div>
                        <p className="font-bold text-sm">{user.name}</p>
                        <p className="text-xs text-muted-foreground">{user.phone}</p>
                        <p className="text-[11px] text-muted-foreground">{user.phase && `${user.phase}, `}Block {user.block}, Flat {user.flat_number}</p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="text-destructive h-9 w-9 p-0 rounded-xl" onClick={() => sa.updateUserStatus(user.id, 'rejected')}><X size={15} /></Button>
                      <Button size="sm" className="h-9 w-9 p-0 rounded-xl shadow-sm" onClick={() => sa.updateUserStatus(user.id, 'approved')}><Check size={15} /></Button>
                    </div>
                  </CardContent>
                </Card>
              )) : (
                <div className="text-center py-16 text-sm text-muted-foreground font-medium">No pending users</div>
              )}
            </TabsContent>

            <TabsContent value="sellers" className="space-y-3 mt-5">
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Store size={15} className="text-amber-600" />
                </div>
                <h3 className="text-sm font-bold">Pending Sellers <span className="text-muted-foreground font-normal text-xs">({sa.pendingSellers.length})</span></h3>
              </div>
              {sa.pendingSellers.length > 0 ? sa.pendingSellers.map(seller => (
                <Card key={seller.id} className="border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all duration-300 rounded-2xl">
                  <CardContent className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-bold text-sm">{seller.business_name}</p>
                        <p className="text-xs text-muted-foreground">{(seller as any).profile?.name} • Block {(seller as any).profile?.block}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-destructive h-9 w-9 p-0 rounded-xl" onClick={() => { setRejectingSellerId(seller.id); setSellerRejectionNote(''); }}><X size={15} /></Button>
                        <Button size="sm" className="h-9 w-9 p-0 rounded-xl shadow-sm" onClick={() => sa.updateSellerStatus(seller.id, 'approved')}><Check size={15} /></Button>
                      </div>
                    </div>
                    {seller.description && <p className="text-xs text-muted-foreground">{seller.description}</p>}
                    {seller.primary_group && <Badge variant="secondary" className="text-[10px] capitalize rounded-md">{seller.primary_group.replace(/_/g, ' ')}</Badge>}
                  </CardContent>
                </Card>
              )) : (
                <div className="text-center py-16 text-sm text-muted-foreground font-medium">No pending sellers</div>
              )}
            </TabsContent>

            <TabsContent value="disputes" className="mt-5"><AdminDisputesTab /></TabsContent>

            <TabsContent value="more" className="mt-5 space-y-6">
              {/* Admins */}
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-violet-500/10 flex items-center justify-center">
                    <Shield size={15} className="text-violet-600" />
                  </div>
                  <h3 className="text-sm font-bold">Admins <span className="text-muted-foreground font-normal text-xs">({sa.societyAdmins.length})</span></h3>
                </div>
                <div className="space-y-2.5">
                  {sa.societyAdmins.map(admin_user => (
                    <Card key={admin_user.id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
                      <CardContent className="p-4 flex items-center justify-between">
                        <div>
                          <p className="font-bold text-sm">{(admin_user as any).user?.name || 'Unknown'}</p>
                          <p className="text-xs text-muted-foreground capitalize">{admin_user.role}</p>
                        </div>
                        {admin_user.user_id !== sa.profile?.id && (
                          <Button size="sm" variant="ghost" className="text-destructive h-9 w-9 p-0 rounded-xl" onClick={() => sa.removeAdmin(admin_user.id)}>
                            <Trash2 size={15} />
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
                <Sheet open={sa.appointOpen} onOpenChange={sa.setAppointOpen}>
                  <SheetTrigger asChild>
                    <Button size="sm" variant="outline" className="gap-1.5 mt-3 rounded-xl font-semibold">
                      <UserPlus size={14} /> Appoint Admin
                    </Button>
                  </SheetTrigger>
                  <SheetContent>
                    <SheetHeader><SheetTitle className="font-bold">Appoint Society Admin</SheetTitle></SheetHeader>
                    <div className="mt-4 space-y-4">
                      <Input placeholder="Search residents by name..." value={sa.searchQuery} onChange={e => sa.searchResidents(e.target.value)} className="rounded-xl" />
                      <div className="space-y-2 max-h-96 overflow-y-auto">
                        {sa.searchResults.map(resident => (
                          <Card key={resident.id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
                            <CardContent className="p-3.5 flex items-center justify-between">
                              <div>
                                <p className="font-bold text-sm">{resident.name}</p>
                                <p className="text-xs text-muted-foreground">Block {resident.block}, Flat {resident.flat_number}</p>
                              </div>
                              <div className="flex gap-1.5">
                                <Button size="sm" variant="outline" className="text-xs rounded-xl" onClick={() => sa.appointAdmin(resident.id, 'moderator')}>Mod</Button>
                                <Button size="sm" className="text-xs rounded-xl" onClick={() => sa.appointAdmin(resident.id, 'admin')}>Admin</Button>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </div>
                  </SheetContent>
                </Sheet>
              </div>

              {/* Payment Milestones */}
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center">
                    <IndianRupee size={15} className="text-emerald-600" />
                  </div>
                  <h3 className="text-sm font-bold">Payment Milestones</h3>
                </div>
                <AdminPaymentMilestones />
              </div>

              {/* Security */}
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-rose-500/10 flex items-center justify-center">
                    <Shield size={15} className="text-rose-600" />
                  </div>
                  <h3 className="text-sm font-bold">Security</h3>
                </div>
                <SecurityModeSettings />
                <div className="mt-3"><SecurityStaffManager /></div>
              </div>

              {/* Features */}
              <div>
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="w-8 h-8 rounded-xl bg-blue-500/10 flex items-center justify-center">
                    <ToggleLeft size={15} className="text-blue-600" />
                  </div>
                  <h3 className="text-sm font-bold">Society Features</h3>
                </div>
                <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
                  <CardContent className="p-4 space-y-4">
                    {sa.features.map(f => {
                      const key = f.feature_key as FeatureKey;
                      const state = sa.getFeatureState(key);
                      const configurable = sa.isConfigurable(key);
                      const enabled = sa.isFeatureEnabled(key);
                      return (
                        <div key={key} className="flex items-center justify-between py-1.5">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <Label className="text-sm font-semibold">{sa.getFeatureDisplayName(key)}</Label>
                              {state === 'locked' && <Badge variant="secondary" className="text-[8px] h-4 gap-0.5 rounded-md"><Lock size={8} /> Locked</Badge>}
                              {state === 'unavailable' && <Badge variant="outline" className="text-[8px] h-4 text-muted-foreground rounded-md">Not in plan</Badge>}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">{sa.getFeatureDescription(key)}</p>
                          </div>
                          <Switch checked={enabled} disabled={!configurable} onCheckedChange={checked => sa.toggleFeature.mutate({ key, enabled: checked })} />
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              </div>

              {/* Settings */}
              <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
                <CardContent className="p-4 space-y-4">
                  <div className="flex items-center gap-2.5 mb-1">
                    <div className="w-8 h-8 rounded-xl bg-muted flex items-center justify-center">
                      <Settings size={15} className="text-muted-foreground" />
                    </div>
                    <h3 className="font-bold text-sm">Society Settings</h3>
                  </div>
                  <div className="flex items-center justify-between py-1.5">
                    <div>
                      <Label className="text-sm font-semibold">Auto-approve residents</Label>
                      <p className="text-xs text-muted-foreground">Skip manual approval</p>
                    </div>
                    <Switch checked={sa.autoApprove} onCheckedChange={checked => { sa.setAutoApprove(checked); sa.updateSocietySettings('auto_approve_residents', checked); }} />
                  </div>
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">Approval Method</Label>
                    <Select value={sa.approvalMethod} onValueChange={value => { sa.setApprovalMethod(value); sa.updateSocietySettings('approval_method', value); }}>
                      <SelectTrigger className="rounded-xl"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual">Manual</SelectItem>
                        <SelectItem value="invite_code">Invite Code</SelectItem>
                        <SelectItem value="auto">Auto (GPS match)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {sa.effectiveSociety?.invite_code && (
                    <div className="p-4 bg-muted/50 rounded-xl">
                      <p className="text-xs text-muted-foreground mb-1 font-medium">Society Invite Code</p>
                      <p className="font-mono font-extrabold text-lg tracking-[0.25em] tabular-nums">{sa.effectiveSociety.invite_code}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        {/* Seller Rejection Dialog */}
        <Dialog open={!!rejectingSellerId} onOpenChange={(open) => { if (!open) { setRejectingSellerId(null); setSellerRejectionNote(''); } }}>
          <DialogContent className="rounded-2xl">
            <DialogHeader>
              <DialogTitle className="font-bold">Reject Seller Application</DialogTitle>
              <DialogDescription>Please provide a reason for rejection. This will be shared with the seller.</DialogDescription>
            </DialogHeader>
            <Textarea
              placeholder="Rejection reason (required)..."
              value={sellerRejectionNote}
              onChange={(e) => setSellerRejectionNote(e.target.value)}
              rows={3}
              className="rounded-xl"
            />
            <DialogFooter className="gap-2">
              <Button variant="outline" className="rounded-xl" onClick={() => { setRejectingSellerId(null); setSellerRejectionNote(''); }}>Cancel</Button>
              <Button
                variant="destructive"
                className="rounded-xl font-semibold"
                disabled={!sellerRejectionNote.trim()}
                onClick={() => {
                  if (rejectingSellerId) {
                    sa.updateSellerStatus(rejectingSellerId, 'rejected', sellerRejectionNote.trim());
                    setRejectingSellerId(null);
                    setSellerRejectionNote('');
                  }
                }}
              >
                Confirm Reject
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppLayout>
  );
}
