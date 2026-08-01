// @ts-nocheck
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, MessageCircle, RefreshCw, Copy } from 'lucide-react';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { DisplayStatusResult } from '@/lib/deriveDisplayStatus';
import { StatusPhaseIcon } from '@/components/order/StatusPhaseIcon';
import { cn } from '@/lib/utils';
import { statusTransition } from '@/lib/motion-variants';

interface ExperienceHeaderProps {
  sellerName: string;
  displayStatus: DisplayStatusResult;
  orderId: string;
  onBack: () => void;
  onCopyId: () => void;
  onRefresh?: () => void;
  onChatOpen?: () => void;
  unreadMessages?: number;
  canChat?: boolean;
  isTerminal?: boolean;
  isRefreshing?: boolean;
}

export function ExperienceHeader({
  sellerName,
  displayStatus,
  orderId,
  onBack,
  onCopyId,
  onRefresh,
  onChatOpen,
  unreadMessages = 0,
  canChat,
  isTerminal,
  isRefreshing,
}: ExperienceHeaderProps) {
  const etaFlagColors: Record<string, string> = {
    on_time: 'bg-primary/10 text-primary border-primary/20',
    slight_delay: 'bg-warning/10 text-warning border-warning/20',
    delayed: 'bg-destructive/10 text-destructive border-destructive/20',
  };

  return (
    <SafeHeader>
      <div className="px-4 pb-3">
        {/* Top row: back, seller name, actions */}
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted shrink-0"
          >
            <ArrowLeft size={18} />
          </button>

          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold truncate">{sellerName}</h1>
            <button
              onClick={onCopyId}
              className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono"
            >
              #{orderId.slice(0, 8)} <Copy size={10} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            {onRefresh && (
              <button
                onClick={onRefresh}
                className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted"
                disabled={isRefreshing}
              >
                <RefreshCw
                  size={16}
                  className={cn(isRefreshing && 'animate-spin')}
                />
              </button>
            )}
            {canChat && onChatOpen ? (
              <button
                onClick={onChatOpen}
                className="relative inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted"
              >
                <MessageCircle size={16} />
                {unreadMessages > 0 && (
                  <motion.span
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 500, damping: 20 }}
                    className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center"
                  >
                    {unreadMessages}
                  </motion.span>
                )}
              </button>
            ) : isTerminal ? (
              <a
                href="/help"
                className="relative inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted opacity-50"
                title="Chat closed — order complete. Need help?"
              >
                <MessageCircle size={16} className="text-muted-foreground" />
              </a>
            ) : null}
          </div>
        </div>

        {/* Status + ETA row */}
        <div className="mt-2.5 flex items-center gap-2.5">
          <motion.div
            animate={!isTerminal ? { scale: [1, 1.06, 1] } : {}}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <StatusPhaseIcon icon={displayStatus.icon} iconColor={displayStatus.iconColor} size="sm" pulse={!isTerminal} />
          </motion.div>
          <AnimatePresence mode="wait">
            <motion.p
              key={displayStatus.phase}
              variants={statusTransition}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.25 }}
              className="text-sm font-semibold text-foreground flex-1"
            >
              {displayStatus.text}
            </motion.p>
          </AnimatePresence>
          {displayStatus.etaText && (
            <motion.span
              key={displayStatus.etaText}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                'text-[11px] font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap',
                displayStatus.etaFlag
                  ? etaFlagColors[displayStatus.etaFlag]
                  : 'bg-primary/10 text-primary border-primary/20'
              )}
            >
              {displayStatus.etaText}
            </motion.span>
          )}
        </div>
      </div>
    </SafeHeader>
  );
}
