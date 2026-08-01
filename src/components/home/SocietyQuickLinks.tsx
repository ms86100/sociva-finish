// @ts-nocheck
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useEffectiveFeatures, type FeatureKey } from '@/hooks/useEffectiveFeatures';
import { useAuth } from '@/contexts/AuthContext';
import {
  Users, Car, IndianRupee, MessageCircle, Wrench, ShieldAlert, ChevronRight, Building2,
} from 'lucide-react';
import { useMarketplaceLabels } from '@/hooks/useMarketplaceLabels';
import { cn } from '@/lib/utils';
import { staggerGrid, cardEntrance } from '@/lib/motion-variants';

interface QuickLink {
  icon: typeof Users;
  label: string;
  to: string;
  featureKey?: FeatureKey;
}

const quickLinks: QuickLink[] = [
  { icon: Users, label: 'Visitors', to: '/visitors', featureKey: 'visitor_management' },
  { icon: Car, label: 'Parking', to: '/parking', featureKey: 'vehicle_parking' },
  { icon: IndianRupee, label: 'Finances', to: '/society/finances', featureKey: 'finances' },
  { icon: MessageCircle, label: 'Bulletin', to: '/community', featureKey: 'bulletin' },
  { icon: Wrench, label: 'Maintenance', to: '/maintenance', featureKey: 'maintenance' },
  { icon: ShieldAlert, label: 'Disputes', to: '/disputes', featureKey: 'disputes' },
];

export function SocietyQuickLinks() {
  const { effectiveSociety } = useAuth();
  const { isFeatureEnabled } = useEffectiveFeatures();
  const ml = useMarketplaceLabels();

  if (!effectiveSociety) return null;

  const visibleLinks = quickLinks.filter(l => !l.featureKey || isFeatureEnabled(l.featureKey));
  if (visibleLinks.length === 0) return null;

  const useGrid = visibleLinks.length <= 6;

  return (
    <div className="mt-2 mb-1">
      <div className="px-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="section-header">
            <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 size={16} className="text-primary" />
            </div>
            {ml.label('label_section_society_links')}
          </h3>
          <Link to="/society" className="text-xs font-bold text-primary flex items-center gap-0.5 hover:underline">
            View all <ChevronRight size={14} />
          </Link>
        </div>
      </div>
      <motion.div
        variants={staggerGrid}
        initial="hidden"
        animate="show"
        className={cn(
          useGrid
            ? 'grid grid-cols-3 gap-2.5 px-4 pb-1'
            : 'flex gap-2.5 overflow-x-auto scrollbar-hide pb-1 px-4 snap-x snap-mandatory'
        )}
      >
        {visibleLinks.slice(0, 6).map(({ icon: Icon, label, to }) => (
          <motion.div key={to} variants={cardEntrance} whileTap={{ scale: 0.96 }}>
            <Link to={to} className={cn(!useGrid && 'shrink-0 snap-start')}>
              <div className="bg-card border border-border rounded-2xl px-3 py-3.5 flex items-center gap-2.5 transition-all duration-200 hover:shadow-card hover:border-primary/20 shadow-sm">
                <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon size={16} className="text-primary" />
                </div>
                <span className="text-xs font-semibold text-foreground whitespace-nowrap">{label}</span>
              </div>
            </Link>
          </motion.div>
        ))}
      </motion.div>
    </div>
  );
}
