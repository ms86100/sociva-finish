// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, Loader2, Package, ShieldCheck, Store, Sparkles } from 'lucide-react';
import { adminNotify } from '@/lib/admin-notify';
import { logAudit } from '@/lib/audit';
import { ProductAttributeBlocks } from '@/components/product/ProductAttributeBlocks';
import { useCurrency } from '@/hooks/useCurrency';
import { notifyProductStatusChange } from '@/lib/admin-notifications';
import { ProductEditDiff } from '@/components/admin/ProductEditDiff';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { splitPendingCatalogQueue } from '@/lib/admin-catalog-queue';

interface PendingProduct {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string | null;
  image_url: string | null;
  is_veg: boolean;
  specifications: Record<string, any> | null;
  approval_status: string;
  seller: {
    id: string;
    business_name: string;
    society_id: string;
    user_id: string;
    verification_status?: string;
  } | null;
}

interface AdminProductApprovalsProps {
  onSwitchToApplications?: () => void;
}

export function AdminProductApprovals({ onSwitchToApplications }: AdminProductApprovalsProps) {
  const { formatPrice } = useCurrency();
  const [products, setProducts] = useState<PendingProduct[]>([]);
  const [pendingApplicationProductCount, setPendingApplicationProductCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  useEffect(() => {
    fetchPending();
  }, []);

  const fetchPending = async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('products')
        .select('id, name, price, category, description, image_url, is_veg, approval_status, created_at, specifications, seller:seller_profiles!products_seller_id_fkey(id, business_name, society_id, user_id, verification_status)')
        .eq('approval_status', 'pending')
        .order('created_at', { ascending: true });

      const all = (data as any[]) || [];
      const { standalone, inApplication } = splitPendingCatalogQueue(all);

      setProducts(standalone);
      setPendingApplicationProductCount(inApplication.length);
    } catch (err) {
      console.error('Failed to fetch pending products:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (product: PendingProduct) => {
    setActionId(product.id);
    try {
      const { error } = await supabase
        .from('products')
        .update({ approval_status: 'approved', rejection_note: null } as any)
        .eq('id', product.id);

      if (error) {
        adminNotify.error('Failed to approve product');
        return;
      }

      // Clear old snapshots so admin only sees future diffs
      await supabase.from('product_edit_snapshots').delete().eq('product_id', product.id);
      await logAudit('product_approved', 'product', product.id, '', {});

      if (product.seller) {
        await notifyProductStatusChange(
          product.seller.user_id,
          product.name,
          product.seller.business_name,
          'approved',
        );
      }

      adminNotify.success('Product approved');
      fetchPending();
    } catch {
      adminNotify.error('Failed to approve product');
    } finally {
      setActionId(null);
    }
  };

  const handleReject = async (product: PendingProduct) => {
    setActionId(product.id);
    try {
      const { error } = await supabase
        .from('products')
        .update({
          approval_status: 'rejected',
          rejection_note: rejectionNote.trim() || null,
        } as any)
        .eq('id', product.id);

      if (error) {
        adminNotify.error('Failed to reject product');
        return;
      }

      await logAudit('product_rejected', 'product', product.id, '', { reason: rejectionNote });

      if (product.seller) {
        await notifyProductStatusChange(
          product.seller.user_id,
          product.name,
          product.seller.business_name,
          'rejected',
          rejectionNote.trim() || undefined,
        );
      }

      adminNotify.success('Product rejected');
      setRejectingId(null);
      setRejectionNote('');
      fetchPending();
    } catch {
      adminNotify.error('Failed to reject product');
    } finally {
      setActionId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="animate-spin text-muted-foreground" size={20} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Informative Banner for Initial Store Applications */}
      {pendingApplicationProductCount > 0 && (
        <div className="bg-gradient-to-r from-primary/10 via-primary/5 to-transparent border border-primary/20 rounded-2xl p-3.5 flex items-start gap-3">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
            <Store size={15} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
              <Sparkles size={12} className="text-primary" />
              {pendingApplicationProductCount} initial catalog product{pendingApplicationProductCount === 1 ? '' : 's'} in pending store applications
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
              When new stores are submitted, their products are clubbed under the <strong>Applications</strong> tab and will be approved automatically together with the store in one click.
            </p>
            {onSwitchToApplications && (
              <Button
                variant="outline"
                size="sm"
                onClick={onSwitchToApplications}
                className="h-7 text-[10px] font-semibold mt-2 rounded-lg border-primary/30 text-primary hover:bg-primary/10"
              >
                Go to Store Applications →
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Package size={14} className="text-amber-600" />
          </div>
          <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">
            Live Store Updates & New Products ({products.length})
          </h3>
        </div>
      </div>

      {products.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-muted/80 flex items-center justify-center mb-2.5">
            <ShieldCheck size={20} className="text-muted-foreground/60" />
          </div>
          <p className="text-sm font-semibold text-foreground">All live store catalogs are up to date</p>
          <p className="text-xs text-muted-foreground max-w-xs mt-1">
            No pending product additions or edits from existing approved stores.
          </p>
        </motion.div>
      ) : (
        products.map((product, idx) => (
          <motion.div key={product.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.03 }}>
            <Card className="border-0 shadow-[var(--shadow-card)] hover:shadow-[var(--shadow-md)] transition-all duration-300 rounded-2xl">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start gap-3">
                  {product.image_url ? (
                    <img src={product.image_url} alt={product.name} className="w-16 h-16 rounded-xl object-cover shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-xl bg-muted flex items-center justify-center shrink-0">
                      <Package size={22} className="text-muted-foreground/50" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-sm truncate">{product.name}</h4>
                      <Badge variant="outline" className="text-[10px] rounded-md">{product.category}</Badge>
                      {product.is_veg && (
                        <span className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded-md">
                          Veg
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-extrabold text-primary mt-0.5">{formatPrice(product.price)}</p>
                    {product.seller && (
                      <p className="text-xs text-muted-foreground mt-0.5">
                        by <span className="font-semibold text-foreground">{product.seller.business_name}</span>
                      </p>
                    )}
                    {product.description && (
                      <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2">{product.description}</p>
                    )}
                    {product.specifications && (
                      <div className="mt-2.5 p-2.5 bg-muted/40 rounded-xl">
                        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">Attributes</p>
                        <ProductAttributeBlocks specifications={product.specifications} />
                      </div>
                    )}
                  </div>
                </div>

                <ProductEditDiff
                  productId={product.id}
                  currentProduct={{
                    name: product.name,
                    price: product.price,
                    category: product.category,
                    description: product.description,
                    image_url: product.image_url,
                    specifications: product.specifications,
                  }}
                />

                {rejectingId === product.id ? (
                  <div className="space-y-2.5 pt-2 border-t border-border/30">
                    <Textarea
                      placeholder="Rejection reason (required)..."
                      value={rejectionNote}
                      onChange={(e) => setRejectionNote(e.target.value)}
                      rows={2}
                      className="rounded-xl text-xs"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex-1 rounded-xl h-8 text-xs" onClick={() => { setRejectingId(null); setRejectionNote(''); }}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="flex-1 rounded-xl h-8 text-xs font-semibold"
                        disabled={actionId === product.id || !rejectionNote.trim()}
                        onClick={() => handleReject(product)}
                      >
                        {actionId === product.id && <Loader2 size={12} className="animate-spin mr-1" />}
                        Confirm Reject
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2 pt-1 border-t border-border/30">
                    <Button size="sm" variant="outline" className="text-destructive flex-1 rounded-xl h-8 text-xs font-semibold" onClick={() => setRejectingId(product.id)} disabled={!!actionId}>
                      <X size={12} className="mr-1" /> Reject Product
                    </Button>
                    <Button size="sm" className="flex-1 rounded-xl h-8 text-xs font-semibold shadow-sm" onClick={() => handleApprove(product)} disabled={!!actionId}>
                      {actionId === product.id && <Loader2 size={12} className="animate-spin mr-1" />}
                      <Check size={12} className="mr-1" /> Approve Product
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        ))
      )}
    </div>
  );
}
