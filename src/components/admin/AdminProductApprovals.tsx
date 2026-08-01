// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Check, X, Loader2, Package, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { logAudit } from '@/lib/audit';
import { ProductAttributeBlocks } from '@/components/product/ProductAttributeBlocks';
import { useCurrency } from '@/hooks/useCurrency';
import { notifyProductStatusChange } from '@/lib/admin-notifications';
import { ProductEditDiff } from '@/components/admin/ProductEditDiff';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

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
  } | null;
}

export function AdminProductApprovals() {
  const { formatPrice } = useCurrency();
  const [products, setProducts] = useState<PendingProduct[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionId, setActionId] = useState<string | null>(null);
  const [rejectionNote, setRejectionNote] = useState('');
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  useEffect(() => {
    fetchPending();
  }, []);

  const fetchPending = async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from('products')
      .select('id, name, price, category, description, image_url, is_veg, approval_status, created_at, specifications, seller:seller_profiles!products_seller_id_fkey(id, business_name, society_id, user_id)')
      .eq('approval_status', 'pending')
      .order('created_at', { ascending: true });
    setProducts((data as any) || []);
    setIsLoading(false);
  };

  const handleApprove = async (product: PendingProduct) => {
    setActionId(product.id);
    const { error } = await supabase.from('products').update({ approval_status: 'approved', rejection_note: null } as any).eq('id', product.id);
    if (error) { toast.error('Failed to approve'); setActionId(null); return; }
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

    toast.success('Product approved');
    setActionId(null);
    fetchPending();
  };

  const handleReject = async (product: PendingProduct) => {
    setActionId(product.id);
    const { error } = await supabase.from('products').update({
      approval_status: 'rejected',
      rejection_note: rejectionNote.trim() || null,
    } as any).eq('id', product.id);
    if (error) { toast.error('Failed to reject'); setActionId(null); return; }
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

    toast.success('Product rejected');
    setActionId(null);
    setRejectingId(null);
    setRejectionNote('');
    fetchPending();
  };

  if (isLoading) {
    return <div className="flex justify-center py-12"><Loader2 className="animate-spin text-muted-foreground" size={20} /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2.5 mb-4">
        <div className="w-8 h-8 rounded-xl bg-amber-500/10 flex items-center justify-center">
          <Package size={15} className="text-amber-600" />
        </div>
        <h3 className="text-sm font-bold text-foreground">
          Pending Products <span className="text-muted-foreground font-normal text-xs">({products.length})</span>
        </h3>
      </div>

      {products.length === 0 ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-2xl bg-muted/80 flex items-center justify-center mb-3">
            <ShieldCheck size={22} className="text-muted-foreground/60" />
          </div>
          <p className="text-sm text-muted-foreground font-medium">No products awaiting approval</p>
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
                    </div>
                    <p className="text-sm font-extrabold text-primary mt-0.5">{formatPrice(product.price)}</p>
                    {product.seller && (
                      <p className="text-xs text-muted-foreground mt-0.5">by <span className="font-semibold">{product.seller.business_name}</span></p>
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
                  <div className="space-y-2.5">
                    <Textarea
                      placeholder="Rejection reason (required)..."
                      value={rejectionNote}
                      onChange={(e) => setRejectionNote(e.target.value)}
                      rows={2}
                      className="rounded-xl"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="rounded-xl" onClick={() => { setRejectingId(null); setRejectionNote(''); }}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        className="rounded-xl font-semibold"
                        disabled={actionId === product.id || !rejectionNote.trim()}
                        onClick={() => handleReject(product)}
                      >
                        {actionId === product.id && <Loader2 size={14} className="animate-spin mr-1" />}
                        Confirm Reject
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-destructive rounded-xl font-semibold" onClick={() => setRejectingId(product.id)} disabled={!!actionId}>
                      <X size={14} className="mr-1" /> Reject
                    </Button>
                    <Button size="sm" className="rounded-xl font-semibold shadow-sm" onClick={() => handleApprove(product)} disabled={!!actionId}>
                      {actionId === product.id && <Loader2 size={14} className="animate-spin mr-1" />}
                      <Check size={14} className="mr-1" /> Approve
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
