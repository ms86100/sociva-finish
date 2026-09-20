// @ts-nocheck
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Loader2 } from 'lucide-react';

export type DeepLinkKind = 'none' | 'screen' | 'store' | 'product';

export interface CampaignDeepLinkValue {
  kind: DeepLinkKind;
  screen: string;
  sellerId: string;
  sellerName: string;
  productId: string;
  productName: string;
  referencePath: string;
}

const SCREEN_OPTIONS = [
  { value: 'marketplace', path: '/marketplace', label: 'Marketplace' },
  { value: 'offers', path: '/offers', label: 'Offers' },
  { value: 'orders', path: '/orders', label: 'Orders' },
  { value: 'bulletin', path: '/bulletin', label: 'Bulletin' },
  { value: 'profile', path: '/profile', label: 'Profile' },
  { value: 'home', path: '/home', label: 'Home' },
];

interface Props {
  value: CampaignDeepLinkValue;
  onChange: (next: CampaignDeepLinkValue) => void;
}

export function emptyDeepLink(): CampaignDeepLinkValue {
  return {
    kind: 'none',
    screen: '',
    sellerId: '',
    sellerName: '',
    productId: '',
    productName: '',
    referencePath: '',
  };
}

export function CampaignDeepLinkPicker({ value, onChange }: Props) {
  const [storeQuery, setStoreQuery] = useState('');
  const [productQuery, setProductQuery] = useState('');
  const [stores, setStores] = useState<{ id: string; business_name: string }[]>([]);
  const [products, setProducts] = useState<{ id: string; name: string; seller_id: string }[]>([]);
  const [loadingStores, setLoadingStores] = useState(false);
  const [loadingProducts, setLoadingProducts] = useState(false);

  useEffect(() => {
    if (value.kind !== 'store') return;
    const t = setTimeout(async () => {
      setLoadingStores(true);
      let q = supabase
        .from('seller_profiles')
        .select('id, business_name')
        .eq('verification_status', 'approved')
        .order('business_name')
        .limit(30);
      if (storeQuery.trim()) q = q.ilike('business_name', `%${storeQuery.trim()}%`);
      const { data } = await q;
      setStores(data || []);
      setLoadingStores(false);
    }, 250);
    return () => clearTimeout(t);
  }, [value.kind, storeQuery]);

  useEffect(() => {
    if (value.kind !== 'product') return;
    const t = setTimeout(async () => {
      setLoadingProducts(true);
      let q = supabase
        .from('products')
        .select('id, name, seller_id')
        .eq('approval_status', 'approved')
        .order('name')
        .limit(30);
      if (productQuery.trim()) q = q.ilike('name', `%${productQuery.trim()}%`);
      const { data } = await q;
      setProducts(data || []);
      setLoadingProducts(false);
    }, 250);
    return () => clearTimeout(t);
  }, [value.kind, productQuery]);

  function setKind(kind: DeepLinkKind) {
    onChange({ ...emptyDeepLink(), kind });
  }

  return (
    <div className="space-y-3">
      <Label className="text-xs font-semibold">Deep link (tap destination)</Label>
      <div className="flex flex-wrap gap-2">
        {[
          { id: 'none', label: 'None' },
          { id: 'screen', label: 'Screen' },
          { id: 'store', label: 'Store' },
          { id: 'product', label: 'Product' },
        ].map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => setKind(opt.id as DeepLinkKind)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${
              value.kind === opt.id
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-background border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {value.kind === 'screen' && (
        <Select
          value={value.screen || '_none'}
          onValueChange={(v) => {
            const opt = SCREEN_OPTIONS.find((s) => s.value === v);
            onChange({
              ...value,
              screen: v === '_none' ? '' : v,
              referencePath: opt?.path || '',
              sellerId: '',
              productId: '',
            });
          }}
        >
          <SelectTrigger className="rounded-xl text-xs">
            <SelectValue placeholder="Choose screen" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_none">Select…</SelectItem>
            {SCREEN_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {value.kind === 'store' && (
        <div className="space-y-2">
          <Input
            placeholder="Search approved stores…"
            value={storeQuery}
            onChange={(e) => setStoreQuery(e.target.value)}
            className="rounded-xl text-xs"
          />
          <div className="max-h-40 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/40">
            {loadingStores ? (
              <p className="text-xs text-muted-foreground p-3 flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </p>
            ) : stores.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">No stores found</p>
            ) : (
              stores.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...value,
                      sellerId: s.id,
                      sellerName: s.business_name,
                      referencePath: `/seller/${s.id}`,
                      screen: 'seller',
                      productId: '',
                      productName: '',
                    })
                  }
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 ${
                    value.sellerId === s.id ? 'bg-primary/10 font-semibold' : ''
                  }`}
                >
                  {s.business_name}
                </button>
              ))
            )}
          </div>
          {value.sellerId && (
            <p className="text-[10px] text-muted-foreground">
              Opens <span className="font-mono text-foreground">{value.referencePath}</span>
            </p>
          )}
        </div>
      )}

      {value.kind === 'product' && (
        <div className="space-y-2">
          <Input
            placeholder="Search approved products…"
            value={productQuery}
            onChange={(e) => setProductQuery(e.target.value)}
            className="rounded-xl text-xs"
          />
          <div className="max-h-40 overflow-y-auto rounded-xl border border-border/50 divide-y divide-border/40">
            {loadingProducts ? (
              <p className="text-xs text-muted-foreground p-3 flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </p>
            ) : products.length === 0 ? (
              <p className="text-xs text-muted-foreground p-3">No products found</p>
            ) : (
              products.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    onChange({
                      ...value,
                      productId: p.id,
                      productName: p.name,
                      sellerId: p.seller_id,
                      referencePath: `/product/${p.id}`,
                      screen: 'product',
                      sellerName: '',
                    })
                  }
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-muted/50 ${
                    value.productId === p.id ? 'bg-primary/10 font-semibold' : ''
                  }`}
                >
                  {p.name}
                </button>
              ))
            )}
          </div>
          {value.productId && (
            <p className="text-[10px] text-muted-foreground">
              Opens <span className="font-mono text-foreground">{value.referencePath}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
