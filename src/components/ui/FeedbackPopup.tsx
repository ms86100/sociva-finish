// @ts-nocheck
import { motion } from 'framer-motion';
import { CheckCircle, Info, AlertTriangle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { easings, durations } from '@/lib/motion-variants';

interface FeedbackPopupProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  variant?: 'success' | 'info' | 'warning';
  actionLabel?: string;
  onAction?: () => void;
}

export function FeedbackPopup({
  isOpen,
  onClose,
  title,
  description,
  variant = 'success',
  actionLabel,
  onAction,
}: FeedbackPopupProps) {
  if (!isOpen) return null;

  const getVariantProps = () => {
    switch (variant) {
      case 'success':
        return {
          icon: CheckCircle,
          bg: 'bg-success/10',
          border: 'border-success/20',
          text: 'text-success',
          iconBg: 'bg-success/20',
          iconText: 'text-success',
        };
      case 'warning':
        return {
          icon: AlertTriangle,
          bg: 'bg-warning/10',
          border: 'border-warning/20',
          text: 'text-warning',
          iconBg: 'bg-warning/20',
          iconText: 'text-warning',
        };
      default: // info
        return {
          icon: Info,
          bg: 'bg-info/10',
          border: 'border-info/20',
          text: 'text-info',
          iconBg: 'bg-info/20',
          iconText: 'text-info',
        };
    }
  };

  const { Icon, bg, border, text, iconBg, iconText } = getVariantProps();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: durations.normal }}
      className="fixed inset-0 z-[100] pointer-events-none"
      aria-hidden={!isOpen}
    >
      {/* Popup */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        transition={{
          type: 'spring',
          stiffness: 350,
          damping: 22,
        }}
        className="fixed inset-0 z-[101] flex items-center justify-center pointer-events-auto"
      >
        <div className={cn(
          "relative rounded-xl max-w-md w-full max-h-[80vh] overflow-hidden",
          bg,
          border,
          "animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-4 duration-300"
        )}>
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute right-3 top-3 w-8 h-8 rounded-full bg-muted/50 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:bg-white hover:text-foreground hover:border-primary/30 transition-all"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Content */}
          <div className="px-4 py-5 space-y-3 text-center">
            {/* Icon */}
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
              <Icon className={`w-6 h-6 ${iconText} ${iconBg}`} />
            </div>

            {/* Title */}
            <motion.h3
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: durations.normal, ease: easings.easeOut }}
              className={cn("text-lg font-semibold text-foreground mb-1", text)}
            >
              {title}
            </motion.h3>

            {/* Description */}
            {description && (
              <motion.p
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.2, duration: durations.normal, ease: easings.easeOut }}
                className="text-sm text-muted-foreground"
              >
                {description}
              </motion.p>
            )}

            {/* Action button */}
            {actionLabel && onAction && (
              <motion.button
                onClick={onAction}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3, duration: durations.normal, ease: easings.easeOut }}
                className={cn(
                  "px-4 py-2 rounded-xl font-medium transition-all hover:bg-muted/80 active:scale-[0.98]",
                  variant === 'success' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'
                )}
              >
                {actionLabel}
              </motion.button>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}