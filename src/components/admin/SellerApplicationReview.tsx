// @ts-nocheck
import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Check, X, Loader2, Store, Package, FileText, Eye, Clock,
  ChevronDown, ChevronUp, MapPin, Phone, Calendar, CreditCard, Truck, Sparkles,
} from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { format } from 'date-fns';
import { useSellerApplicationReview } from '@/hooks/useSellerApplicationReview';
import { AdminProductApprovals } from './AdminProductApprovals';
import { ApplicationCatalogPreview } from './ApplicationCatalogPreview';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { isApprovedLiveStore, pendingApplicationCatalogCount } from '@/lib/admin-catalog-queue';

function statusBadge(status: string) {
  switch (status) {
    case 'pending': return <Badge variant="outline" className="text-warning border-warning rounded-md text-[10px]"><Clock size={10} className="mr-1" /> Pending</Badge>;
    case 'approved': return <Badge variant="outline" className="text-success border-success rounded-md text-[10px]"><Check size={10} className="mr-1" /> Approved</Badge>;
    case 'rejected': return <Badge variant="outline" className="text-destructive border-destructive rounded-md text-[10px]"><X size={10} className="mr-1" /> Rejected</Badge>;
    default: return <Badge variant="outline" className="rounded-md text-[10px]">{status}</Badge>;
  }
}

export function SellerApplicationReview() {
  const s = useSellerApplicationReview();
  const [reviewTab, setReviewTab] = useState('applications');

  if (s.isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>;
  }

  const pendingApps = s.applications.filter(a => a.verification_status === 'pending');
  const allApps = s.applications;

  return (
    <div className="space-y-4">
      <Tabs value={reviewTab} onValueChange={setReviewTab} className="w-full">
        <TabsList className="w-full h-9 rounded-xl bg-muted/60 p-0.5">
          <TabsTrigger value="applications" className="flex-1 text-xs rounded-lg font-semibold data-[state=active]:shadow-sm gap-1.5">
            <Store size={13} /> Applications
            {pendingApps.length > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded-full ml-0.5">{pendingApps.length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="products" className="flex-1 text-xs rounded-lg font-semibold data-[state=active]:shadow-sm gap-1.5">
            <Package size={13} /> Products
            {s.pendingProductCount > 0 && <Badge variant="secondary" className="text-[9px] h-4 px-1.5 rounded-full ml-0.5">{s.pendingProductCount}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="all" className="flex-1 text-xs rounded-lg font-semibold data-[state=active]:shadow-sm gap-1.5">
            All
          </TabsTrigger>
        </TabsList>

        <TabsContent value="applications" className="mt-4">
          <SellerList sellers={pendingApps} s={s} emptyMsg="No pending seller applications" />
        </TabsContent>

        <TabsContent value="products" className="mt-4">
          <AdminProductApprovals onSwitchToApplications={() => setReviewTab('applications')} />
        </TabsContent>

        <TabsContent value="all" className="mt-4">
          <SellerList sellers={allApps} s={s} emptyMsg="No sellers found" />
        </TabsContent>
      </Tabs>

      {/* Document Preview Dialog */}
      <Dialog open={!!s.previewUrl} onOpenChange={() => s.setPreviewUrl(null)}>
        <DialogContent className="max-w-lg rounded-2xl">
          <DialogHeader><DialogTitle className="font-bold">License Document</DialogTitle></DialogHeader>
          {s.previewUrl && (
            s.previewUrl.match(/\.(jpg|jpeg|png|webp)$/i)
              ? <img src={s.previewUrl} alt="License" className="w-full rounded-xl" />
              : <div className="text-center py-8"><FileText size={48} className="mx-auto text-muted-foreground mb-4" /><a href={s.previewUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline font-semibold">Open Document</a></div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Group License Config Dialog */}
      <Dialog open={!!s.editingGroup} onOpenChange={() => s.setEditingGroup(null)}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="font-bold">Configure License for {s.editingGroup?.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-semibold">License Type Name</label>
              <input placeholder="e.g., FSSAI Certificate" value={s.editForm.license_type_name} onChange={(e) => s.setEditForm({ ...s.editForm, license_type_name: e.target.value })} className="flex h-10 w-full rounded-xl border border-input bg-background px-3 py-2 text-sm" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold">Description for Sellers</label>
              <Textarea placeholder="Instructions for sellers..." value={s.editForm.license_description} onChange={(e) => s.setEditForm({ ...s.editForm, license_description: e.target.value })} rows={3} className="rounded-xl" />
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 rounded-xl h-10" onClick={() => s.setEditingGroup(null)}>Cancel</Button>
              <Button className="flex-1 rounded-xl h-10 font-semibold" onClick={s.saveGroupConfig}>Save</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ── Compact Seller List ── */
function SellerList({ sellers, s, emptyMsg }: { sellers: any[]; s: ReturnType<typeof useSellerApplicationReview>; emptyMsg: string }) {
  if (sellers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="w-14 h-14 rounded-2xl bg-muted/80 flex items-center justify-center mb-3">
          <Store size={22} className="text-muted-foreground/60" />
        </div>
        <p className="text-sm text-muted-foreground font-medium">{emptyMsg}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {sellers.map((seller, idx) => (
        <SellerCard key={seller.id} seller={seller} s={s} idx={idx} />
      ))}
    </div>
  );
}

/* ── Compact Seller Card ── */
function SellerCard({ seller, s, idx }: { seller: any; s: ReturnType<typeof useSellerApplicationReview>; idx: number }) {
  const isExpanded = s.expandedId === seller.id;
  const pendingLicenses = seller.licenses.filter((l: any) => l.status === 'pending').length;
  const isLiveStore = isApprovedLiveStore(seller.verification_status);
  const openingCatalog = isLiveStore
    ? seller.products.filter((p: any) => p.approval_status === 'approved')
    : seller.products;
  const openingPendingCount = pendingApplicationCatalogCount(openingCatalog);
  const liveUpdateCount = isLiveStore
    ? seller.products.filter((p: any) => p.approval_status === 'pending').length
    : 0;
  const isPending = seller.verification_status === 'pending';

  // Location status
  const hasDirectCoords = seller.latitude != null && seller.longitude != null;
  const hasSocietyFallback = !hasDirectCoords && seller.society_id != null;
  const noLocation = !hasDirectCoords && !seller.society_id;

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.02 }}>
      <Card className={cn('border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all duration-300 rounded-2xl', isPending && 'ring-1 ring-warning/30')}>
        <CardContent className="p-0">
          {/* Compact Header — always visible */}
          <div className="p-3 cursor-pointer flex items-center gap-3" onClick={() => s.setExpandedId(isExpanded ? null : seller.id)}>
            {seller.profile_image_url ? (
              <img src={seller.profile_image_url} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center shrink-0"><Store size={16} className="text-muted-foreground/60" /></div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-bold text-sm truncate">{seller.business_name}</p>
                {statusBadge(seller.verification_status)}
                {noLocation && (
                  <Badge variant="outline" className="text-[9px] text-destructive border-destructive rounded-md h-5">
                    <MapPin size={8} className="mr-0.5" /> No Location
                  </Badge>
                )}
                {hasSocietyFallback && !hasDirectCoords && (
                  <Badge variant="outline" className="text-[9px] text-warning border-warning rounded-md h-5">
                    <MapPin size={8} className="mr-0.5" /> Society
                  </Badge>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground truncate">
                {seller.profile?.name}
                {seller.society?.name && ` • ${seller.society.name}`}
                {seller.profile?.flat_number && ` • ${seller.profile.flat_number}`}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {pendingLicenses > 0 && <Badge variant="outline" className="text-[9px] text-warning border-warning rounded-md h-5"><FileText size={8} className="mr-0.5" />{pendingLicenses}</Badge>}
              {!isLiveStore && openingCatalog.length > 0 && (
                <Badge variant="outline" className="text-[9px] text-primary border-primary/30 rounded-md h-5">
                  <Sparkles size={8} className="mr-0.5" />{openingCatalog.length}
                </Badge>
              )}
              {liveUpdateCount > 0 && (
                <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300 rounded-md h-5">
                  <Package size={8} className="mr-0.5" />{liveUpdateCount}
                </Badge>
              )}
              {isExpanded ? <ChevronUp size={14} className="text-muted-foreground" /> : <ChevronDown size={14} className="text-muted-foreground" />}
            </div>
          </div>

          {/* Expanded Details */}
          {isExpanded && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="px-3 pb-3 space-y-3 border-t border-border/30 pt-3">
              {/* Store Info Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-[11px] text-muted-foreground bg-muted/30 rounded-xl p-3">
                {seller.primary_group && <div><span className="font-semibold text-foreground">Category:</span> {seller.primary_group.replace(/_/g, ' ')}</div>}
                {seller.default_action_type && (
                  <div><span className="font-semibold text-foreground">Store mode:</span> {seller.default_action_type.replace(/_/g, ' ')}</div>
                )}
                {seller.profile?.phone && <div className="flex items-center gap-1"><Phone size={9} /> {seller.profile.phone}</div>}
                {(seller.availability_start || seller.availability_end) && <div className="flex items-center gap-1"><Calendar size={9} /> {seller.availability_start || '—'} – {seller.availability_end || '—'}</div>}
                <div className="flex items-center gap-1"><CreditCard size={9} /> COD: {seller.accepts_cod ? '✓' : '✗'} | UPI: {seller.accepts_upi ? '✓' : '✗'}</div>
                {seller.fulfillment_mode && <div className="flex items-center gap-1"><Truck size={9} /> {seller.fulfillment_mode.replace(/_/g, ' ')}</div>}
                {seller.society?.address && <div className="flex items-center gap-1 col-span-2"><MapPin size={9} /> {seller.society.address}</div>}
                {seller.categories?.length > 0 && <div className="col-span-2">Sub: {seller.categories.map((c: string) => c.replace(/_/g, ' ')).join(', ')}</div>}
                <div>Applied: {format(new Date(seller.created_at), 'dd MMM yyyy')}</div>
              </div>

              {seller.description && <p className="text-xs text-muted-foreground px-1">{seller.description}</p>}
              {seller.cover_image_url && <img src={seller.cover_image_url} alt="Cover" className="w-full h-24 rounded-xl object-cover" />}

              {/* Licenses — inline compact */}
              {seller.licenses.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest px-1">Licenses ({seller.licenses.length})</p>
                  {seller.licenses.map((lic: any) => (
                    <div key={lic.id} className="bg-muted/40 rounded-xl p-2.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <DynamicIcon name={(lic as any).group?.icon || 'FileText'} size={14} />
                          <span className="text-xs font-semibold truncate">{lic.license_type}</span>
                          {statusBadge(lic.status)}
                        </div>
                        {lic.license_number && <p className="text-[10px] text-muted-foreground">#{lic.license_number}</p>}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {lic.document_url && <Button size="sm" variant="outline" className="h-6 w-6 p-0 rounded-lg" onClick={(e) => { e.stopPropagation(); s.setPreviewUrl(lic.document_url); }}><Eye size={11} /></Button>}
                        {lic.status === 'pending' && (
                          <>
                            <Button size="sm" variant="outline" className="h-6 text-destructive text-[10px] px-2 rounded-lg" disabled={!s.licenseAdminNotes.trim()} onClick={(e) => { e.stopPropagation(); s.updateLicenseStatus(lic.id, 'rejected'); }}><X size={10} /></Button>
                            <Button size="sm" className="h-6 text-[10px] px-2 rounded-lg" onClick={(e) => { e.stopPropagation(); s.updateLicenseStatus(lic.id, 'approved'); }}><Check size={10} /></Button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                  {seller.licenses.some((l: any) => l.status === 'pending') && (
                    <Textarea placeholder="License admin notes (required for rejection)" value={s.licenseAdminNotes} onChange={(e) => s.setLicenseAdminNotes(e.target.value)} rows={1} className="text-xs rounded-xl" onClick={(e) => e.stopPropagation()} />
                  )}
                </div>
              )}

              {/* Opening catalog — clubbed with first-time application */}
              <ApplicationCatalogPreview
                products={openingCatalog}
                formatPrice={s.formatPrice}
                storePending={!isLiveStore}
              />

              {isLiveStore && liveUpdateCount > 0 && (
                <div className="rounded-xl border border-amber-200/70 bg-amber-50/70 px-3 py-2">
                  <p className="text-[11px] font-semibold text-amber-800">
                    {liveUpdateCount} later listing{liveUpdateCount === 1 ? '' : 's'} waiting in the Products tab
                  </p>
                  <p className="text-[10px] text-amber-700/80 mt-0.5">
                    New products and edits after the store went live are reviewed separately so the original application stays intact.
                  </p>
                </div>
              )}

              {/* Seller Approve/Reject */}
              {isPending && (
                <div className="pt-2 border-t border-border/30 space-y-2">
                  <p className="text-[10px] text-muted-foreground bg-primary/5 border border-primary/10 rounded-lg px-3 py-1.5 leading-relaxed">
                    Approving this store also approves the opening catalog{openingPendingCount > 0 ? ` (${openingPendingCount} listing${openingPendingCount === 1 ? '' : 's'})` : ''} and pending licenses in one step.
                  </p>
                  {s.rejectingId === seller.id ? (
                    <div className="space-y-2">
                      <Textarea placeholder="Rejection reason (required)..." value={s.rejectionNote} onChange={(e) => s.setRejectionNote(e.target.value)} rows={2} className="rounded-xl" />
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="flex-1 rounded-xl h-8 text-xs" onClick={() => { s.setRejectingId(null); s.setRejectionNote(''); }}>Cancel</Button>
                        <Button size="sm" variant="destructive" className="flex-1 rounded-xl h-8 text-xs font-semibold" disabled={s.actionId === seller.id || !s.rejectionNote.trim()} onClick={() => s.updateSellerStatus(seller, 'rejected')}>
                          {s.actionId === seller.id && <Loader2 size={12} className="animate-spin mr-1" />}Reject
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="text-destructive flex-1 rounded-xl h-8 text-xs font-semibold" onClick={() => s.setRejectingId(seller.id)} disabled={!!s.actionId}><X size={12} className="mr-1" /> Reject</Button>
                      <Button size="sm" className="flex-1 rounded-xl h-9 text-xs font-semibold shadow-sm" onClick={() => s.updateSellerStatus(seller, 'approved')} disabled={!!s.actionId}>
                        {s.actionId === seller.id && <Loader2 size={12} className="animate-spin mr-1" />}
                        <Check size={12} className="mr-1" />
                        {openingPendingCount > 0 ? `Approve store & ${openingPendingCount} listing${openingPendingCount === 1 ? '' : 's'}` : 'Approve store'}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
