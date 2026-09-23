// @ts-nocheck
import { motion } from 'framer-motion';
import { Store, MapPin, Compass, UserPlus, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { discoveryPulse, emptyState } from '@/lib/motion-variants';

type Props = {
  onTryAnother: () => void;
  onSelectManual: () => void;
  onBrowseCategories: () => void;
  onInvite: () => void;
};

export function DiscoveryEmptyPanel({
  onTryAnother,
  onSelectManual,
  onBrowseCategories,
  onInvite,
}: Props) {
  return (
    <div className="flex min-h-[100dvh] flex-col justify-center bg-background px-6 py-12 safe-top">
      <motion.div
        className="mx-auto w-full max-w-md space-y-8"
        variants={emptyState}
        initial="hidden"
        animate="show"
      >
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="relative">
            <motion.div
              className="absolute inset-0 -m-3 rounded-full bg-primary/15"
              variants={discoveryPulse}
              animate="animate"
            />
            <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-muted text-foreground">
              <Store size={28} strokeWidth={2} />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-foreground">
              Nothing nearby yet
            </h1>
            <p className="text-sm leading-relaxed text-muted-foreground">
              We couldn&apos;t find stores serving this location.
            </p>
            <p className="text-xs text-muted-foreground/80 pt-1">
              Your neighbourhood is still growing. Be the change - invite a seller, or try another
              spot.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <Button className="h-12 w-full gap-2 text-base font-semibold" onClick={onTryAnother}>
            <MapPin size={18} />
            Try another location
          </Button>
          <Button
            variant="outline"
            className="h-12 w-full gap-2 text-base font-semibold"
            onClick={onSelectManual}
          >
            <MapPin size={18} />
            Select manually
          </Button>
          <Button
            variant="outline"
            className="h-12 w-full gap-2 text-base font-semibold"
            onClick={onBrowseCategories}
          >
            <Compass size={18} />
            Explore categories
          </Button>
        </div>

        <div className="border-t border-border/60 pt-6 space-y-3 text-center">
          <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Sparkles size={18} />
          </div>
          <p className="text-sm font-semibold text-foreground">Be the change</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            Know a great local seller? Invite them to join Sociva.
          </p>
          <Button
            variant="secondary"
            className="h-11 w-full gap-2 font-semibold"
            onClick={onInvite}
          >
            <UserPlus size={16} />
            Invite a business
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
