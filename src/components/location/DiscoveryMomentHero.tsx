// @ts-nocheck
import { motion } from 'framer-motion';
import { MapPin, Navigation, Loader2, UtensilsCrossed, ShoppingBag, Scissors, Heart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { floatSlow, orbitBob, discoveryPulse } from '@/lib/motion-variants';
import type { AtmosphereProduct } from '@/hooks/useDiscoveryAtmosphereProducts';
import { cn } from '@/lib/utils';

type Props = {
  products: AtmosphereProduct[];
  busy?: boolean;
  onUseLocation: () => void;
  onSelectManual: () => void;
};

const ORBIT = [
  { icon: UtensilsCrossed, label: 'Food', className: 'left-[12%] top-[28%]' },
  { icon: ShoppingBag, label: 'Essentials', className: 'right-[10%] top-[26%]' },
  { icon: Scissors, label: 'Services', className: 'left-[14%] bottom-[38%]' },
  { icon: Heart, label: 'Local', className: 'right-[12%] bottom-[36%]' },
];

const CATEGORY_ROW = [
  { icon: UtensilsCrossed, label: 'Food' },
  { icon: ShoppingBag, label: 'Essentials' },
  { icon: Scissors, label: 'Services' },
  { icon: Heart, label: 'Local' },
];

const CARD_SLOTS = [
  { className: 'left-[4%] top-[8%] rotate-[-8deg]', delay: 0 },
  { className: 'right-[2%] top-[6%] rotate-[7deg]', delay: 0.4 },
  { className: 'left-[6%] top-[36%] rotate-[5deg]', delay: 0.8 },
  { className: 'right-[4%] top-[34%] rotate-[-6deg]', delay: 1.2 },
  { className: 'left-[10%] bottom-[22%] rotate-[-4deg]', delay: 0.2 },
  { className: 'right-[8%] bottom-[20%] rotate-[9deg]', delay: 0.6 },
  { className: 'left-[28%] top-[14%] rotate-[3deg]', delay: 1.0 },
  { className: 'right-[26%] top-[42%] rotate-[-5deg]', delay: 1.4 },
];

function actionGhost(actionType: string | null | undefined) {
  if (actionType === 'book') return 'Book';
  if (actionType === 'contact_seller' || actionType === 'enquire') return 'View';
  return 'Add';
}

export function DiscoveryMomentHero({ products, busy, onUseLocation, onSelectManual }: Props) {
  const cards = CARD_SLOTS.map((slot, i) => ({
    ...slot,
    product: products[i % Math.max(products.length, 1)] || null,
  }));

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-background">
      {/* Atmosphere cards - curiosity only, titled “On Sociva” (no fake society name) */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        {cards.map((slot, i) => (
          <motion.div
            key={i}
            className={cn(
              'absolute w-[118px] rounded-2xl border border-border/40 bg-card/80 shadow-lg overflow-hidden',
              slot.className,
            )}
            variants={floatSlow}
            animate="animate"
            style={{ animationDelay: `${slot.delay}s` }}
            transition={{ delay: slot.delay }}
          >
            <div className="relative h-[88px] bg-muted">
              {slot.product?.image_url ? (
                <img
                  src={slot.product.image_url}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                <div className="h-full w-full bg-gradient-to-br from-primary/20 to-muted" />
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-4">
                <span className="text-[10px] font-semibold text-white tabular-nums">
                  {slot.product?.price != null ? `₹${Math.round(slot.product.price)}` : '-'}
                </span>
                <span className="rounded-md bg-white/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white">
                  {actionGhost(slot.product?.action_type)}
                </span>
              </div>
            </div>
            <p className="truncate px-2 py-1.5 text-[10px] font-medium text-foreground/80">
              {slot.product?.name || 'On Sociva'}
            </p>
          </motion.div>
        ))}
        <div className="absolute inset-0 bg-background/55 backdrop-blur-[10px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
      </div>

      <div className="relative z-10 flex min-h-[100dvh] flex-col justify-center px-6 py-12 safe-top">
        <div className="mx-auto w-full max-w-md">
          <div className="mb-6 flex flex-col items-center gap-2">
            <img
              src="/sociva_app_icon_2.svg"
              alt="Sociva"
              className="h-12 w-12 rounded-xl shadow-sm"
              width={48}
              height={48}
            />
            <p className="text-center text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
              Sociva
            </p>
            <p className="text-center text-sm font-medium text-foreground/80">
              Your Community Marketplace
            </p>
          </div>

          <div className="relative mx-auto mb-8 h-40 w-full max-w-xs">
            {ORBIT.map((item, i) => {
              const Icon = item.icon;
              return (
                <motion.div
                  key={item.label}
                  className={cn(
                    'absolute flex h-11 w-11 items-center justify-center rounded-full border border-border/60 bg-card/90 shadow-md text-primary',
                    item.className,
                  )}
                  custom={i}
                  variants={orbitBob}
                  animate="animate"
                  title={item.label}
                >
                  <Icon size={16} strokeWidth={2.25} />
                </motion.div>
              );
            })}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <motion.div
                className="absolute inset-0 -m-3 rounded-full bg-primary/25"
                variants={discoveryPulse}
                animate="animate"
              />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg">
                <MapPin size={26} strokeWidth={2.25} />
              </div>
            </div>
          </div>

          <div className="mb-7 space-y-3 text-center">
            <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-foreground">
              Discover what&apos;s available near you
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Food, services &amp; local businesses - all around you.
            </p>
          </div>

          <div className="space-y-3">
            <Button
              className="h-12 w-full gap-2 text-base font-semibold"
              onClick={onUseLocation}
              disabled={busy}
            >
              {busy ? <Loader2 className="animate-spin" size={18} /> : <Navigation size={18} />}
              Use my location
            </Button>
            <Button
              variant="outline"
              className="h-12 w-full text-base font-semibold"
              onClick={onSelectManual}
              disabled={busy}
            >
              Select my location manually
            </Button>
          </div>

          <div className="mt-6 grid grid-cols-4 gap-2">
            {CATEGORY_ROW.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.label}
                  className="flex flex-col items-center gap-1.5 rounded-xl border border-border/50 bg-card/60 px-1 py-2.5"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
                    <Icon size={14} strokeWidth={2.25} />
                  </div>
                  <span className="text-[10px] font-medium text-muted-foreground">{item.label}</span>
                </div>
              );
            })}
          </div>

          <p className="mt-6 text-center text-[11px] leading-relaxed text-muted-foreground">
            Browse freely. Sign in only when you&apos;re ready to connect.
          </p>
          <p className="mt-4 text-center text-xs font-medium text-foreground/55">
            Built for neighbourhoods - discover local, together.
          </p>
        </div>
      </div>
    </div>
  );
}
