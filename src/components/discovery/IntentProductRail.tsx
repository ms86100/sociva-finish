import { ProductListingCard, type ProductWithSeller } from '@/components/product/ProductListingCard';
import { SellingWellProductCard } from '@/components/home/SellingWellProductCard';
import { hasRailDensity } from '@/lib/discovery-density';

export function IntentProductRail({
  title,
  products,
  onProductTap,
  categoryConfigs,
  variant = 'default',
}: {
  title: string;
  products: ProductWithSeller[];
  onProductTap: (product: ProductWithSeller) => void;
  categoryConfigs?: any[];
  /** Mockup Selling well nearby cards (image, price, serves, fulfillment, orders). */
  variant?: 'default' | 'selling-well';
}) {
  if (!hasRailDensity(products.length)) return null;
  const sellingWell = variant === 'selling-well' || title === 'Selling well nearby';
  return (
    <section className="mt-3" data-testid={sellingWell ? 'selling-well-rail' : undefined}>
      <h3 className="px-4 mb-2.5 font-extrabold text-[17px] tracking-tight text-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-3 px-4 pb-1 items-stretch">
        {products.map((product) => (
          <div key={product.id} className="min-w-0 h-full">
            {sellingWell ? (
              <SellingWellProductCard
                product={product}
                onTap={onProductTap}
                categoryConfigs={categoryConfigs}
              />
            ) : (
              <ProductListingCard
                product={product}
                onTap={onProductTap}
                categoryConfigs={categoryConfigs}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
