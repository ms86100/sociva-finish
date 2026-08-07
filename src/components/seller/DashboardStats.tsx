// @ts-nocheck
import { motion } from 'framer-motion';
import { Card, CardContent } from '@/components/ui/card';
import { Hand, ChefHat, Bike, CheckCircle2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { KPI_TO_FILTER, type SellerOrderFilter } from '@/lib/seller-order-board';
import { staggerGrid, cardEntrance, pulseRing } from '@/lib/motion-variants';

interface DashboardStatsProps {
  pendingOrders: number;
  preparingOrders: number;
  inTransitOrders: number;
  doneToday: number;
  terminalFailOrders: number;
  onKpiClick?: (filter: SellerOrderFilter) => void;
  refreshing?: boolean;
}

export function DashboardStats({
  pendingOrders,
  preparingOrders,
  inTransitOrders,
  doneToday,
  terminalFailOrders,
  onKpiClick,
  refreshing,
}: DashboardStatsProps) {
  const stats = [
    {
      id: 'action_needed',
      icon: Hand,
      value: pendingOrders,
      label: 'Action needed',
      borderColor: 'border-l-warning',
      color: 'text-warning',
      pulse: pendingOrders > 0,
    },
    {
      id: 'preparing',
      icon: ChefHat,
      value: preparingOrders,
      label: 'Preparing',
      borderColor: 'border-l-info',
      color: 'text-info',
    },
    {
      id: 'in_transit',
      icon: Bike,
      value: inTransitOrders,
      label: 'In transit',
      borderColor: 'border-l-primary',
      color: 'text-primary',
    },
    {
      id: 'done_today',
      icon: CheckCircle2,
      value: doneToday,
      label: 'Done today',
      borderColor: 'border-l-success',
      color: 'text-success',
    },
    {
      id: 'terminal_fail',
      icon: AlertTriangle,
      value: terminalFailOrders,
      label: 'Failed',
      borderColor: 'border-l-muted-foreground/40',
      color: 'text-muted-foreground',
      dim: terminalFailOrders === 0,
    },
  ];

  return (
    <motion.div
      className="grid grid-cols-5 gap-2"
      variants={staggerGrid}
      initial="hidden"
      animate="show"
      key={refreshing ? 'refreshing' : 'idle'}
    >
      {stats.map(({ id, icon: Icon, value, label, color, borderColor, pulse, dim }) => {
        const filter = KPI_TO_FILTER[id];
        return (
          <motion.div key={id} variants={cardEntrance}>
            <Card
              role={onKpiClick && filter ? 'button' : undefined}
              tabIndex={onKpiClick && filter ? 0 : undefined}
              onClick={() => filter && onKpiClick?.(filter)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && filter) {
                  e.preventDefault();
                  onKpiClick?.(filter);
                }
              }}
              className={cn(
                'border-l-2 transition-shadow',
                borderColor,
                onKpiClick && 'cursor-pointer hover:shadow-md active:scale-[0.98]',
                pulse && 'ring-1 ring-warning/40',
                dim && 'opacity-60',
              )}
            >
              <CardContent className="p-2 text-center">
                <motion.div
                  variants={pulse ? pulseRing : undefined}
                  animate={pulse ? 'pulse' : 'idle'}
                >
                  <Icon className={cn('mx-auto mb-0.5', color)} size={16} />
                </motion.div>
                <p className="text-base font-bold tabular-nums leading-tight">{value}</p>
                <p className="text-[10px] text-muted-foreground leading-tight">{label}</p>
              </CardContent>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}
