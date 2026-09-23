// @ts-nocheck
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminStoreSearchPicker } from '@/components/admin/AdminStoreSearchPicker';
import {
  adminStorePaths,
  useAdminManagedSeller,
} from '@/contexts/AdminManagedSellerContext';
import { useCommandCenterStore360 } from '@/hooks/useCommandCenter';
import { useCurrency } from '@/hooks/useCurrency';
import {
  ArrowLeft,
  Calendar,
  ClipboardList,
  MessageSquare,
  Package,
  Settings2,
  Shield,
  Store,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export default function AdminStoreManagerPage() {
  const { sellerId: routeSellerId } = useParams<{ sellerId?: string }>();
  const navigate = useNavigate();
  const { formatPrice } = useCurrency();
  const {
    managedSellerId,
    managedSellerProfile,
    setManagedSeller,
    clearManagedSeller,
    loadingProfile,
  } = useAdminManagedSeller();

  const activeSellerId = routeSellerId || managedSellerId;
  const storeQuery = useCommandCenterStore360(activeSellerId || null);
  const store = storeQuery.data;
  const [pickerValue, setPickerValue] = useState(activeSellerId || '');

  useEffect(() => {
    if (routeSellerId) {
      setManagedSeller(routeSellerId);
      setPickerValue(routeSellerId);
    }
  }, [routeSellerId, setManagedSeller]);

  const paths = activeSellerId ? adminStorePaths(activeSellerId) : null;

  const onPickStore = (sellerId: string) => {
    if (!sellerId) return;
    setManagedSeller(sellerId);
    setPickerValue(sellerId);
    navigate(`/admin/stores/${sellerId}`);
  };

  const exitManage = () => {
    clearManagedSeller();
    setPickerValue('');
    navigate('/admin/stores');
  };

  const cards = activeSellerId && paths
    ? [
        {
          key: 'products',
          title: 'Products / listings',
          desc: 'Full CRUD - create, edit, delete, availability',
          icon: Package,
          to: paths.products,
          metric: store ? `${store.listings?.live ?? 0} live · ${store.listings?.pending ?? 0} pending` : null,
        },
        {
          key: 'services',
          title: 'Services / bookings',
          desc: 'Open Command Center bookings filtered to this store',
          icon: Calendar,
          to: `/admin/command-center?tab=bookings&seller=${activeSellerId}`,
          metric: null,
        },
        {
          key: 'orders',
          title: 'Orders',
          desc: 'Orders for this store (Command Center)',
          icon: ClipboardList,
          to: `/admin/command-center?tab=orders&seller=${activeSellerId}`,
          metric: store ? `${store.activity?.orders_30d ?? 0} in 30d` : null,
        },
        {
          key: 'enquiries',
          title: 'Enquiries / messages',
          desc: 'Unanswered leads and chats',
          icon: MessageSquare,
          to: `/admin/command-center?tab=enquiries&seller=${activeSellerId}`,
          metric: store ? `${store.activity?.enquiries_unanswered ?? 0} unanswered` : null,
        },
        {
          key: 'settings',
          title: 'Store settings',
          desc: 'Hours, payments, vacation, location, categories',
          icon: Settings2,
          to: paths.settings,
          metric: null,
        },
        {
          key: 'audit',
          title: 'Audit snapshot',
          desc: 'Verification, disputes, reviews - more than seller sees',
          icon: Shield,
          to: `#audit`,
          metric: store ? `${store.quality?.open_disputes ?? 0} open disputes` : null,
          scrollTo: 'audit',
        },
      ]
    : [];

  return (
    <AppLayout showHeader={false} showNav={false} showCart={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link
            to="/admin"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0"
          >
            <ArrowLeft size={18} />
          </Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold">Store manager</h1>
            <p className="text-xs text-muted-foreground">Search, audit, and manage seller stores</p>
          </div>
        </div>
      </SafeHeader>

      <div className="px-4 pb-24 space-y-4 max-w-3xl mx-auto">
        <div className="rounded-2xl border border-border/60 bg-card p-4 space-y-3">
          <div className="flex items-start gap-2">
            <Store size={18} className="text-primary mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">Find a store</p>
              <p className="text-xs text-muted-foreground">
                Search by name, phone, or id - then manage products and settings on their behalf.
              </p>
            </div>
          </div>
          <AdminStoreSearchPicker
            value={pickerValue}
            onChange={(id) => onPickStore(id)}
            showBalance={false}
            helperText="Selecting a store opens the full store manager console."
          />
          {activeSellerId && (
            <Button variant="outline" size="sm" className="rounded-xl gap-1.5" onClick={exitManage}>
              <X size={14} /> Exit managed store
            </Button>
          )}
        </div>

        {activeSellerId && (
          <>
            {(loadingProfile || storeQuery.isLoading) && !store ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-20 rounded-2xl" />
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base font-bold">
                    {store?.business_name || managedSellerProfile?.business_name || 'Store'}
                  </h2>
                  {store?.verification_status && (
                    <Badge variant="outline" className="capitalize text-[10px]">
                      {store.verification_status}
                    </Badge>
                  )}
                  {store?.vacation_mode && <Badge variant="secondary">Vacation</Badge>}
                  {store && !store.is_available && <Badge variant="secondary">Unavailable</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {store?.owner_name || 'Owner'} · {store?.owner_phone || '-'} ·{' '}
                  {store?.society_name || 'No society'}
                </p>
                {store?.rating != null && (
                  <p className="text-xs">
                    Rating {Number(store.rating).toFixed(1)} ({store.total_reviews ?? 0} reviews)
                  </p>
                )}
                <p className="text-[11px] text-amber-800 dark:text-amber-200 font-medium">
                  Managing as admin - seller keeps their own login; your session stays admin.
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {cards.map((card) => {
                const Icon = card.icon;
                const content = (
                  <div
                    className={cn(
                      'rounded-2xl border border-border/60 bg-card p-4 h-full text-left hover:border-primary/40 transition-colors',
                    )}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
                        <Icon size={15} className="text-primary" />
                      </div>
                      <p className="text-sm font-bold">{card.title}</p>
                    </div>
                    <p className="text-xs text-muted-foreground">{card.desc}</p>
                    {card.metric && (
                      <p className="text-[11px] font-semibold mt-2 text-foreground">{card.metric}</p>
                    )}
                  </div>
                );
                if (card.scrollTo) {
                  return (
                    <button
                      key={card.key}
                      type="button"
                      className="block w-full"
                      onClick={() =>
                        document.getElementById(card.scrollTo)?.scrollIntoView({ behavior: 'smooth' })
                      }
                    >
                      {content}
                    </button>
                  );
                }
                return (
                  <Link key={card.key} to={card.to} className="block">
                    {content}
                  </Link>
                );
              })}
            </div>

            <div id="audit" className="rounded-2xl border border-border/60 bg-card p-4 space-y-3 scroll-mt-20">
              <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
                Audit detail
              </p>
              {store ? (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <AuditMetric label="Orders (30d)" value={store.activity?.orders_30d ?? 0} />
                  <AuditMetric label="Completed" value={store.activity?.orders_completed ?? 0} />
                  <AuditMetric label="Live listings" value={store.listings?.live ?? 0} />
                  <AuditMetric label="Pending listings" value={store.listings?.pending ?? 0} />
                  <AuditMetric label="Open disputes" value={store.quality?.open_disputes ?? 0} />
                  <AuditMetric
                    label="Unanswered enquiries"
                    value={store.activity?.enquiries_unanswered ?? 0}
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Select a store to load audit metrics.</p>
              )}
              {store?.recent_products?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-1">Recent products</p>
                  <ul className="space-y-1">
                    {store.recent_products.slice(0, 5).map((p) => (
                      <li key={p.product_id} className="text-xs flex justify-between gap-2">
                        <span className="truncate">{p.name}</span>
                        <span className="text-muted-foreground shrink-0 capitalize">
                          {p.approval_status} · {formatPrice(p.price)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {paths && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild size="sm" className="rounded-xl">
                    <Link to={paths.products}>Manage products</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="rounded-xl">
                    <Link to={paths.settings}>Edit settings</Link>
                  </Button>
                  <Button asChild size="sm" variant="outline" className="rounded-xl">
                    <Link to={`/seller/${activeSellerId}`}>Buyer storefront preview</Link>
                  </Button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </AppLayout>
  );
}

function AuditMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted/40 p-3">
      <p className="text-muted-foreground">{label}</p>
      <p className="text-lg font-bold tabular-nums">{value}</p>
    </div>
  );
}
