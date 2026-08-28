// @ts-nocheck
import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import { Search, Store, Package, ShoppingBag, Calendar, MessageSquare, AlertTriangle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useCommandCenterGlobalSearch } from '@/hooks/useCommandCenter';

const SECTIONS = [
  { key: 'sellers', label: 'Stores', icon: Store },
  { key: 'products', label: 'Products', icon: Package },
  { key: 'orders', label: 'Orders', icon: ShoppingBag },
  { key: 'bookings', label: 'Bookings', icon: Calendar },
  { key: 'enquiries', label: 'Enquiries', icon: MessageSquare },
  { key: 'disputes', label: 'Disputes', icon: AlertTriangle },
] as const;

export function CommandCenterGlobalSearch({
  societyId,
  onSelectSeller,
  onSelectProduct,
  onSelectOrder,
  onSelectBooking,
  onSelectEnquiry,
  onSelectDispute,
}: {
  societyId: string | null | undefined;
  onSelectSeller?: (sellerId: string) => void;
  onSelectProduct?: (productId: string, sellerId: string) => void;
  onSelectOrder?: (orderId: string, sellerId: string) => void;
  onSelectBooking?: (bookingId: string, sellerId: string) => void;
  onSelectEnquiry?: (enquiryId: string, sellerId: string) => void;
  onSelectDispute?: (disputeId: string, orderId: string | null, sellerId: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const searchQuery = useCommandCenterGlobalSearch(societyId, debounced);
  const data = searchQuery.data;
  const showResults = debounced.trim().length >= 2;

  return (
    <div className="relative">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Global search: store, product, order, dispute…"
          className="h-10 pl-9 rounded-xl text-sm"
        />
      </div>

      {showResults && (
        <Card className="absolute z-50 mt-2 w-full border shadow-lg rounded-2xl max-h-[70vh] overflow-y-auto">
          <CardContent className="p-3 space-y-3">
            {searchQuery.isLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 rounded-xl" />
                ))}
              </div>
            ) : (
              SECTIONS.map(({ key, label, icon: Icon }) => {
                const rows = data?.[key] || [];
                if (!rows.length) return null;
                return (
                  <div key={key}>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5 flex items-center gap-1">
                      <Icon size={12} />
                      {label}
                    </p>
                    <div className="space-y-1">
                      {rows.map((row: Record<string, unknown>) => {
                        const id =
                          (row.seller_id as string) ||
                          (row.product_id as string) ||
                          (row.order_id as string) ||
                          (row.booking_id as string) ||
                          (row.enquiry_id as string) ||
                          (row.dispute_id as string);
                        const title =
                          (row.name as string) ||
                          (row.business_name as string) ||
                          (row.buyer_name as string) ||
                          `#${String(id).slice(0, 8)}`;
                        const subtitle =
                          (row.seller_name as string) ||
                          (row.status as string) ||
                          (row.category as string) ||
                          '';

                        return (
                          <button
                            key={String(id)}
                            type="button"
                            className="w-full text-left rounded-xl px-3 py-2 hover:bg-muted/60 transition-colors"
                            onClick={() => {
                              if (key === 'sellers' && onSelectSeller) onSelectSeller(row.seller_id as string);
                              if (key === 'products' && onSelectProduct)
                                onSelectProduct(row.product_id as string, row.seller_id as string);
                              if (key === 'orders' && onSelectOrder)
                                onSelectOrder(row.order_id as string, row.seller_id as string);
                              if (key === 'bookings' && onSelectBooking)
                                onSelectBooking(row.booking_id as string, row.seller_id as string);
                              if (key === 'enquiries' && onSelectEnquiry)
                                onSelectEnquiry(row.enquiry_id as string, row.seller_id as string);
                              if (key === 'disputes' && onSelectDispute)
                                onSelectDispute(
                                  row.dispute_id as string,
                                  (row.order_id as string) || null,
                                  (row.seller_id as string) || null,
                                );
                              setQuery('');
                              setDebounced('');
                            }}
                          >
                            <p className="text-sm font-semibold truncate">{title}</p>
                            {subtitle && (
                              <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })
            )}
            {showResults && !searchQuery.isLoading && data && SECTIONS.every(({ key }) => !(data[key]?.length)) && (
              <p className="text-sm text-muted-foreground text-center py-4">No matches for "{debounced}"</p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
