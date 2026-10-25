import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, Undo2, Store, UtensilsCrossed, CalendarClock, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useCart } from '@/hooks/useCart';
import {
  clearedCartSummary,
  clearClearedCartSnapshot,
  emptyCartHeadline,
  readClearedCartSnapshot,
  type ClearedCartSnapshot,
} from '@/lib/cleared-cart';
import { toast } from 'sonner';
import { optimizedImageUrl } from '@/utils/imageHelpers';
import { cn } from '@/lib/utils';

interface CartEmptyExperienceProps {
  justCleared: boolean;
}

const SHORTCUTS = [
  { to: '/', label: 'Home Food', icon: UtensilsCrossed },
  { to: '/book', label: 'Book a slot', icon: CalendarClock },
  { to: '/favorites', label: 'Favourites', icon: Heart },
  { to: '/orders', label: 'Your orders', icon: Store },
] as const;

export function CartEmptyExperience({ justCleared }: CartEmptyExperienceProps) {
  const { addItem } = useCart();
  const [snapshot, setSnapshot] = useState<ClearedCartSnapshot | null>(() => readClearedCartSnapshot());
  const [restoring, setRestoring] = useState(false);
  const showUndo = !!snapshot && snapshot.lines.length > 0 && (justCleared || Date.now() - snapshot.at < 10 * 60 * 1000);
  const copy = useMemo(
    () => emptyCartHeadline(new Date(), {
      justCleared: justCleared || showUndo,
      sellerName: showUndo ? snapshot?.sellerName : null,
    }),
    [justCleared, showUndo, snapshot?.sellerName],
  );
  const summary = clearedCartSummary(snapshot);
  const sellerPath = snapshot?.sellerId ? `/seller/${snapshot.sellerId}` : null;

  const restore = async () => {
    if (!snapshot || restoring) return;
    setRestoring(true);
    try {
      for (const line of snapshot.lines) {
        if (!line.product) continue;
        await addItem(line.product as never, line.quantity, true);
      }
      clearClearedCartSnapshot();
      setSnapshot(null);
      toast.success('Those items are back in your bag');
    } catch {
      toast.error('Could not restore the bag. Try adding from home.');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 28 }}
      className="px-1 space-y-4"
      data-testid="cart-empty-experience"
    >
      <div className="relative overflow-hidden rounded-3xl border border-border/70 bg-gradient-to-b from-primary/10 via-background to-muted/30 px-5 pt-7 pb-6 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <ShoppingBag size={28} className="text-primary" strokeWidth={1.75} />
        </div>
        <h1 className="text-[22px] font-bold tracking-tight text-foreground">{copy.title}</h1>
        <p className="mx-auto mt-1.5 max-w-[19rem] text-sm leading-relaxed text-muted-foreground">
          {showUndo && summary ? summary : copy.subtitle}
        </p>
        {showUndo && summary && (
          <p className="mx-auto mt-1 max-w-[19rem] text-xs text-muted-foreground">{copy.subtitle}</p>
        )}

        {showUndo && (
          <div className="mt-4">
            <div className="mb-3 flex justify-center gap-2">
              {snapshot!.lines.slice(0, 3).map((line) => (
                <div
                  key={line.productId}
                  className="h-12 w-12 overflow-hidden rounded-xl border border-border bg-muted"
                >
                  {line.imageUrl ? (
                    <img
                      src={optimizedImageUrl(line.imageUrl, { width: 96 })}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-muted" />
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                size="sm"
                className="rounded-full h-11 font-semibold"
                onClick={restore}
                disabled={restoring}
              >
                <Undo2 size={14} className="mr-1.5" />
                {restoring ? 'Putting them back…' : 'Undo clear'}
              </Button>
              {sellerPath && snapshot?.sellerName && (
                <Button asChild variant="outline" size="sm" className="rounded-full">
                  <Link to={sellerPath}>
                    <Store size={14} className="mr-1.5" />
                    Back to {snapshot.sellerName}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        )}

        {!showUndo && (
          <div className="mt-5">
            <Button asChild className="h-11 w-full rounded-full font-semibold">
              <Link to="/">See what's nearby</Link>
            </Button>
          </div>
        )}
      </div>

      <div>
        <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          Quick picks
        </p>
        <div className="grid grid-cols-2 gap-2">
          {SHORTCUTS.map(({ to, label, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              className={cn(
                'flex items-center gap-2 rounded-2xl border border-border/80 bg-card px-3 py-3',
                'text-sm font-medium text-foreground active:bg-muted/60',
              )}
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-muted">
                <Icon size={16} className="text-muted-foreground" />
              </span>
              {label}
            </Link>
          ))}
        </div>
      </div>

      {showUndo && (
        <Button asChild variant="ghost" className="w-full text-muted-foreground">
          <Link to="/">Keep browsing nearby</Link>
        </Button>
      )}
    </motion.div>
  );
}
