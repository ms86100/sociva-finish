// @ts-nocheck
import { PaymentMethod } from '@/types/database';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { Banknote, Smartphone, CreditCard, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { usePaymentMode } from '@/hooks/usePaymentMode';

interface PaymentMethodSelectorProps {
  acceptsCod: boolean;
  acceptsUpi: boolean;
  selectedMethod: PaymentMethod;
  onSelect: (method: PaymentMethod) => void;
}

export function PaymentMethodSelector({
  acceptsCod,
  acceptsUpi,
  selectedMethod,
  onSelect,
}: PaymentMethodSelectorProps) {
  const { upiProviderLabel } = useSystemSettings();
  const { isUpiDeepLink, isRazorpay } = usePaymentMode();

  const methods = isRazorpay
    ? [
        {
          id: 'upi' as PaymentMethod,
          label: 'Pay Online',
          description: 'Pay securely via Razorpay (UPI, Cards, Wallets)',
          icon: CreditCard,
          enabled: true,
          color: 'text-info',
          bgColor: 'bg-info/10',
        },
        {
          id: 'cod' as PaymentMethod,
          label: 'Cash on Delivery',
          description: 'Pay when you receive',
          icon: Banknote,
          enabled: acceptsCod,
          color: 'text-success',
          bgColor: 'bg-success/10',
        },
      ]
    : [
        {
          id: 'upi' as PaymentMethod,
          label: 'UPI Payment',
          description: isUpiDeepLink ? 'Pay directly via UPI app' : `Pay via ${upiProviderLabel}`,
          icon: Smartphone,
          enabled: acceptsUpi,
          color: 'text-info',
          bgColor: 'bg-info/10',
        },
        {
          id: 'cod' as PaymentMethod,
          label: 'Cash on Delivery',
          description: 'Pay when you receive',
          icon: Banknote,
          enabled: acceptsCod,
          color: 'text-success',
          bgColor: 'bg-success/10',
        },
      ];

  return (
    <div className="space-y-3">
      {methods.map(({ id, label, description, icon: Icon, enabled, color, bgColor }) => (
        <button
          key={id}
          onClick={() => enabled && onSelect(id)}
          disabled={!enabled}
          className={cn(
            'w-full text-left',
            !enabled && 'opacity-50 cursor-not-allowed'
          )}
        >
          <Card className={cn(
            'transition-all',
            selectedMethod === id && enabled && 'ring-2 ring-primary'
          )}>
            <CardContent className="p-4 flex items-center gap-4 min-h-[60px]">
              <div className={cn('w-12 h-12 shrink-0 rounded-full flex items-center justify-center', bgColor)}>
                <Icon className={color} size={24} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold">{label}</p>
                <p className="text-sm text-muted-foreground">{description}</p>
                {!enabled && (
                  <p className="text-xs text-destructive mt-1">Not available for this seller</p>
                )}
              </div>
              <AnimatePresence>
                {selectedMethod === id && enabled && (
                  <motion.div
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 15 }}
                    className="w-6 h-6 rounded-full bg-primary flex items-center justify-center"
                  >
                    <Check className="text-primary-foreground" size={14} />
                  </motion.div>
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </button>
      ))}
    </div>
  );
}