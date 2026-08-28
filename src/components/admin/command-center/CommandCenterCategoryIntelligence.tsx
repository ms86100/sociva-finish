// @ts-nocheck
import { ChevronRight, FolderTree, Package, Store } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import type { CategoryIntelligenceData } from '@/hooks/useCommandCenter';
import { useCurrency } from '@/hooks/useCurrency';

export function CommandCenterCategoryIntelligence({
  data,
  isLoading,
  selectedCategory,
  selectedSubcategoryId,
  onSelectCategory,
  onSelectSubcategory,
  onSelectSeller,
  onSelectProduct,
  onBack,
}: {
  data: CategoryIntelligenceData | undefined;
  isLoading?: boolean;
  selectedCategory: string | null;
  selectedSubcategoryId: string | null;
  onSelectCategory: (category: string) => void;
  onSelectSubcategory: (category: string, subcategoryId: string) => void;
  onSelectSeller?: (sellerId: string) => void;
  onSelectProduct?: (productId: string, sellerId: string) => void;
  onBack?: () => void;
}) {
  const { formatPrice } = useCurrency();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-16 rounded-2xl" />
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <Card className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
        <CardContent className="p-6 text-sm text-muted-foreground text-center">
          Category intelligence unavailable.
        </CardContent>
      </Card>
    );
  }

  const breadcrumb = selectedSubcategoryId
    ? `${selectedCategory} › ${data.subcategory_name || 'Subcategory'}`
    : selectedCategory || 'All categories';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <FolderTree size={16} className="text-violet-600 shrink-0" />
          <p className="text-sm font-semibold truncate">{breadcrumb}</p>
        </div>
        {(selectedCategory || selectedSubcategoryId) && onBack && (
          <Button size="sm" variant="ghost" className="h-8 rounded-xl text-xs shrink-0" onClick={onBack}>
            Back
          </Button>
        )}
      </div>

      {data.level === 'root' && data.categories && (
        <div className="space-y-2">
          {data.categories.map((cat) => (
            <Card
              key={cat.category}
              className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden cursor-pointer hover:ring-1 hover:ring-primary/20"
              onClick={() => onSelectCategory(cat.category)}
            >
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{cat.category}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {cat.seller_count} stores · {cat.product_count} products · {cat.orders_30d} orders (30d)
                  </p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data.level === 'category' && data.subcategories && (
        <div className="space-y-2">
          {data.subcategories.map((sub) => (
            <Card
              key={sub.subcategory_id}
              className="border-0 shadow-[var(--shadow-card)] rounded-2xl overflow-hidden cursor-pointer hover:ring-1 hover:ring-primary/20"
              onClick={() => onSelectSubcategory(selectedCategory!, sub.subcategory_id)}
            >
              <CardContent className="p-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">{sub.subcategory_name}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {sub.seller_count} stores · {sub.product_count} products
                  </p>
                </div>
                <ChevronRight size={16} className="text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {data.level === 'subcategory' && (
        <>
          {data.sellers && data.sellers.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Stores</p>
              {data.sellers.map((seller) => (
                <Card key={seller.seller_id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-violet-500/10 flex items-center justify-center shrink-0">
                        <Store size={14} className="text-violet-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{seller.business_name}</p>
                        <p className="text-xs text-muted-foreground">
                          {seller.product_count} products · {seller.orders_30d} orders (30d)
                        </p>
                      </div>
                    </div>
                    {onSelectSeller && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-xl text-xs shrink-0"
                        onClick={() => onSelectSeller(seller.seller_id)}
                      >
                        Open
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {data.products && data.products.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Products</p>
              {data.products.map((product) => (
                <Card key={product.product_id} className="border-0 shadow-[var(--shadow-card)] rounded-2xl">
                  <CardContent className="p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-xl bg-emerald-500/10 flex items-center justify-center shrink-0">
                        <Package size={14} className="text-emerald-600" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold truncate">{product.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {product.seller_name} · {formatPrice(product.price)}
                        </p>
                        <Badge variant="outline" className="text-[10px] h-5 mt-1 capitalize">
                          {product.approval_status}
                        </Badge>
                      </div>
                    </div>
                    {onSelectProduct && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 rounded-xl text-xs shrink-0"
                        onClick={() => onSelectProduct(product.product_id, product.seller_id)}
                      >
                        Store
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
