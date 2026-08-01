// @ts-nocheck
import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { VegBadge } from '@/components/ui/veg-badge';
import { Badge } from '@/components/ui/badge';
import { ProductActionType, ProductCategory } from '@/types/database';
import { SellerSwitcher } from '@/components/seller/SellerSwitcher';
import { ArrowLeft, Plus, Edit, Trash2, Star, Store, ShieldAlert, Upload, Send, CheckCircle2, Clock, XCircle, FileText, Eye, AlertTriangle } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { toast } from 'sonner';
import { BulkProductUpload } from '@/components/seller/BulkProductUpload';
import { useCurrency } from '@/hooks/useCurrency';
import { useSellerProducts } from '@/hooks/useSellerProducts';
import { ProductPerformanceBadge, getPerformanceLevel } from '@/components/seller/ProductPerformanceBadge';

export default function SellerProductsPage() {
  const navigate = useNavigate();
  const sp = useSellerProducts();
  const { formatPrice, currencySymbol } = useCurrency();
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({});
  const [orderCounts, setOrderCounts] = useState<Record<string, number>>({});

  // Fetch 7-day view counts + 14-day order counts
  useEffect(() => {
    if (!sp.sellerProfile?.id || sp.products.length === 0) return;
    const productIds = sp.products.map(p => p.id);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    // Parallel fetch: views + order items
    Promise.all([
      supabase
        .from('product_views' as any)
        .select('product_id')
        .in('product_id', productIds)
        .gte('viewed_at', sevenDaysAgo),
      supabase
        .from('order_items')
        .select('product_id')
        .in('product_id', productIds)
        .gte('created_at', fourteenDaysAgo),
    ]).then(([viewsRes, ordersRes]) => {
      if (viewsRes.data) {
        const counts: Record<string, number> = {};
        (viewsRes.data as any[]).forEach(row => { counts[row.product_id] = (counts[row.product_id] || 0) + 1; });
        setViewCounts(counts);
      }
      if (ordersRes.data) {
        const counts: Record<string, number> = {};
        (ordersRes.data as any[]).forEach(row => { counts[row.product_id] = (counts[row.product_id] || 0) + 1; });
        setOrderCounts(counts);
      }
    });
  }, [sp.sellerProfile?.id, sp.products.length]);
  if (sp.isLoading) {
    return <AppLayout showHeader={false}><div className="p-4"><Skeleton className="h-8 w-32 mb-4" /><Skeleton className="h-12 w-full mb-4" />{[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl mb-3" />)}</div></AppLayout>;
  }

  return (
    <AppLayout showHeader={false}>
      <div className="p-4">
        <div className="flex items-center justify-between gap-2 mb-6">
          <Link to="/seller" className="shrink-0 inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted text-muted-foreground">
            <ArrowLeft size={18} />
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            {/* Bulk Add: desktop/tablet only — hidden on mobile to keep Add Product prominent */}
            <Button variant="outline" size="sm" onClick={() => sp.setIsBulkOpen(true)} className="hidden md:inline-flex">
              <Upload size={14} className="mr-1" />Bulk Add
            </Button>
            {/* Add Product: desktop/tablet only — mobile uses FAB below */}
            <Button size="sm" onClick={() => navigate('/seller/products/new')} className="shrink-0 hidden md:inline-flex">
              <Plus size={14} className="mr-1" />Add Product
            </Button>
          </div>
        </div>

        {sp.sellerProfile && <BulkProductUpload isOpen={sp.isBulkOpen} onClose={() => sp.setIsBulkOpen(false)} sellerId={sp.sellerProfile.id} allowedCategories={sp.allowedCategories} onSuccess={() => sp.sellerProfile && sp.fetchData(sp.sellerProfile.id)} />}

        {sp.sellerProfile && (
          <div className="mb-4 p-3 bg-card rounded-xl shadow-sm border"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center"><Store size={18} className="text-primary" /></div><div><h2 className="font-semibold text-sm">{sp.sellerProfile.business_name}</h2><p className="text-xs text-muted-foreground capitalize">{sp.primaryGroup?.replace('_', ' ')} • {sp.products.length} products</p></div></div>{sp.sellerProfiles.length > 1 && <SellerSwitcher />}</div></div>
        )}

        {sp.licenseBlocked?.blocked && (
          <div className={`mb-4 p-3 rounded-xl border flex items-start gap-3 ${sp.licenseBlocked.status === 'rejected' ? 'bg-destructive/10 border-destructive/30' : 'bg-warning/10 border-warning/30'}`}>
            <ShieldAlert size={20} className={sp.licenseBlocked.status === 'rejected' ? 'text-destructive mt-0.5' : 'text-warning mt-0.5'} />
            <div><p className={`text-sm font-semibold ${sp.licenseBlocked.status === 'rejected' ? 'text-destructive' : 'text-warning'}`}>{sp.licenseBlocked.status === 'rejected' ? `${sp.licenseBlocked.licenseName} Rejected` : sp.licenseBlocked.status === 'pending' ? `${sp.licenseBlocked.licenseName} Pending Verification` : `${sp.licenseBlocked.licenseName} Required`}</p><p className="text-xs text-muted-foreground mt-0.5">{sp.licenseBlocked.status === 'rejected' ? 'Your license was rejected. Please re-upload from Seller Settings.' : sp.licenseBlocked.status === 'pending' ? 'Your license is being reviewed.' : 'You need to upload your license from Seller Settings.'}</p></div>
          </div>
        )}




        <h1 className="text-xl font-bold mb-4">Your Products ({sp.products.length})</h1>

        {sp.products.some(p => (p as any).approval_status === 'draft') && (
          <div className="mb-4 p-3 bg-primary/5 border border-primary/20 rounded-xl flex items-center justify-between">
            <div><p className="text-sm font-medium">{sp.products.filter(p => (p as any).approval_status === 'draft').length} draft product(s) ready</p><p className="text-xs text-muted-foreground">Submit for admin review to make them visible to buyers</p></div>
            <Button size="sm" onClick={async () => { const allDrafts = sp.products.filter(p => (p as any).approval_status === 'draft'); const readyDrafts = allDrafts.filter(p => p.image_url); const skipped = allDrafts.length - readyDrafts.length; if (readyDrafts.length === 0) { toast.error('All drafts are missing images. Add images before submitting.'); return; } const draftIds = readyDrafts.map(p => p.id); const { error } = await supabase.from('products').update({ approval_status: 'pending' } as any).in('id', draftIds); if (error) { toast.error('Failed to submit'); return; } toast.success(`${draftIds.length} product(s) submitted for approval`); if (skipped > 0) toast.warning(`${skipped} draft(s) skipped — add images first`); if (sp.sellerProfile) sp.fetchData(sp.sellerProfile.id); }}><Send size={14} className="mr-1" />Submit All for Approval</Button>
          </div>
        )}

        {sp.products.length > 0 ? (
          <div className="space-y-3">
            {sp.products.map((product) => {
              const approvalStatus = (product as any).approval_status || 'approved';
              const showPendingHint = approvalStatus === 'pending';
              const stockQty = (product as any).stock_quantity;
              const lowThreshold = (product as any).low_stock_threshold ?? 5;
              const isLowStock = stockQty != null && stockQty > 0 && stockQty <= lowThreshold;
              const perfLevel = getPerformanceLevel(product, orderCounts, sp.products);
              return (
                <div key={product.id} className={`bg-card rounded-xl p-4 shadow-sm transition-opacity ${!product.is_available ? 'opacity-60' : ''}`}>
                  <div className="flex items-start gap-3">
                    <div className="w-16 h-16 rounded-lg overflow-hidden shrink-0 relative">
                      {product.image_url ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover" /> : <div className="w-full h-full bg-muted flex items-center justify-center"><DynamicIcon name={sp.configs.find(c => c.category === product.category)?.icon || 'Package'} size={24} /></div>}
                      {!product.is_available && <div className="absolute inset-0 bg-background/70 flex items-center justify-center"><span className="text-[10px] font-medium text-destructive">Out of Stock</span></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-2 flex-wrap">
                        {(() => { const c = sp.configs.find(c => c.category === product.category); return (c?.formHints.showVegToggle ?? false) && <VegBadge isVeg={product.is_veg} size="sm" />; })()}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-medium truncate">{product.name}</h3>
                            {approvalStatus === 'draft' && <Badge variant="outline" className="text-[10px] px-1 gap-0.5 border-muted-foreground/30"><Clock size={10} /> Draft</Badge>}
                            {approvalStatus === 'pending' && <Badge className="bg-warning/20 text-warning-foreground text-[10px] px-1 gap-0.5"><Clock size={10} /> Pending</Badge>}
                            {approvalStatus === 'rejected' && <Badge variant="destructive" className="text-[10px] px-1 gap-0.5"><XCircle size={10} /> Rejected</Badge>}
                            {approvalStatus === 'rejected' && (product as any).rejection_note && (
                              <p className="w-full text-xs text-destructive mt-1 bg-destructive/10 rounded-lg px-2.5 py-1.5">
                                <span className="font-semibold">Reason:</span> {(product as any).rejection_note}
                              </p>
                            )}
                            {approvalStatus === 'approved' && <Badge className="bg-success/20 text-success text-[10px] px-1 gap-0.5"><CheckCircle2 size={10} /> Live</Badge>}
                            {product.is_bestseller && <Badge className="bg-warning/20 text-warning-foreground text-[10px] px-1"><Star size={10} className="mr-0.5 fill-warning text-warning" />Bestseller</Badge>}
                            {isLowStock && <Badge className="bg-destructive/15 text-destructive text-[10px] px-1 gap-0.5"><AlertTriangle size={10} /> Low Stock ({stockQty})</Badge>}
                            <ProductPerformanceBadge level={perfLevel} />
                          </div>
                          <p className="text-sm font-semibold text-primary">{formatPrice(product.price)}</p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {viewCounts[product.id] > 0 && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                <Eye size={10} /> {viewCounts[product.id]} views
                              </span>
                            )}
                            {orderCounts[product.id] > 0 && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                📦 {orderCounts[product.id]} orders
                              </span>
                            )}
                            {viewCounts[product.id] > 0 && orderCounts[product.id] > 0 && (
                              <span className="text-[10px] text-primary font-medium">
                                {((orderCounts[product.id] / viewCounts[product.id]) * 100).toFixed(0)}% conv.
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2 flex-wrap">
                        <Button size="sm" variant="outline" onClick={() => navigate(`/seller/products/${product.id}/edit`)}><Edit size={14} className="mr-1" />Edit</Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => sp.setDeleteTarget(product)}><Trash2 size={14} /></Button>
                        {approvalStatus === 'draft' && <Button size="sm" variant="secondary" onClick={async () => { if (!product.image_url) { toast.error('Add an image before submitting for approval'); return; } const { error } = await supabase.from('products').update({ approval_status: 'pending' } as any).eq('id', product.id); if (error) { toast.error('Failed to submit'); return; } toast.success('Submitted for approval'); if (sp.sellerProfile) sp.fetchData(sp.sellerProfile.id); }}><Send size={14} className="mr-1" />Submit</Button>}
                        {showPendingHint && <span className="text-xs text-muted-foreground italic">Under review — edits are still allowed</span>}
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      {approvalStatus === 'approved' ? (
                        <><Switch checked={product.is_available} onCheckedChange={() => sp.toggleAvailability(product)} /><span className="text-[10px] text-muted-foreground">{product.is_available ? 'In Stock' : 'Out'}</span></>
                      ) : (
                        <span className="text-[10px] text-muted-foreground italic px-1 text-center">Pending Review</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-12 bg-muted rounded-xl"><p className="text-muted-foreground mb-4">No products yet</p><Button onClick={() => navigate('/seller/products/new')}><Plus size={16} className="mr-1" />Add Your First Product</Button></div>
        )}
      </div>

      {!sp.licenseBlocked?.blocked && (
        <button
          type="button"
          aria-label="Add Product"
          onClick={() => navigate('/seller/products/new')}
          className="md:hidden fixed right-4 bottom-20 z-40 h-14 px-5 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center gap-2 font-semibold active:scale-95 transition-transform"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <Plus size={20} />
          Add Product
        </button>
      )}

      <AlertDialog open={!!sp.deleteTarget} onOpenChange={(open) => !open && sp.setDeleteTarget(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Delete "{sp.deleteTarget?.name}"?</AlertDialogTitle><AlertDialogDescription>This product will be permanently removed.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep Product</AlertDialogCancel><AlertDialogAction onClick={sp.confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
