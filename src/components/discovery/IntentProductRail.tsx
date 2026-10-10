import { ProductListingCard, type ProductWithSeller } from '@/components/product/ProductListingCard';

export function IntentProductRail({
  title,
  products,
  onProductTap,
  categoryConfigs,
}: {
  title: string;
  products: ProductWithSeller[];
  onProductTap: (product: ProductWithSeller) => void;
  categoryConfigs?: any[];
}) {
  if (!products.length) return null;
  return (
    <section className="mt-3">
      <h3 className="px-4 mb-2 font-extrabold text-[15px] tracking-tight text-foreground">{title}</h3>
      <div className="grid grid-cols-2 gap-2.5 px-4 pb-1 items-stretch">
        {products.map((product) => (
          <div key={product.id} className="min-w-0">
            <ProductListingCard
              product={product}
              onTap={onProductTap}
              categoryConfigs={categoryConfigs}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
