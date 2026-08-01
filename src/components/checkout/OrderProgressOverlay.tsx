// @ts-nocheck
import { memo, useState, useEffect } from 'react';
import { CheckCircle, ShoppingCart, CreditCard, Package } from 'lucide-react';
import { cn } from '@/lib/utils';

interface OrderProgressOverlayProps {
  isVisible: boolean;
  step: 'validating' | 'creating' | 'confirming';
}

const STEPS = [
  { key: 'validating', icon: ShoppingCart, label: 'Validating cart…' },
  { key: 'creating', icon: Package, label: 'Creating order…' },
  { key: 'confirming', icon: CreditCard, label: 'Confirming payment…' },
] as const;

const RING_SIZE = 56;
const RING_STROKE = 4;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

// Delay showing overlay to prevent flash on fast connections
const SHOW_DELAY_MS = 400;

function ProgressRing({ progress }: { progress: number }) {
  const offset = RING_CIRCUMFERENCE - (progress / 100) * RING_CIRCUMFERENCE;
  return (
    <svg width={RING_SIZE} height={RING_SIZE} className="transform -rotate-90">
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="hsl(var(--muted))"
        strokeWidth={RING_STROKE}
      />
      <circle
        cx={RING_SIZE / 2}
        cy={RING_SIZE / 2}
        r={RING_RADIUS}
        fill="none"
        stroke="hsl(var(--primary))"
        strokeWidth={RING_STROKE}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={offset}
        className="transition-all duration-500 ease-out"
      />
    </svg>
  );
}

function OrderProgressOverlayInner({ isVisible, step }: OrderProgressOverlayProps) {
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    if (!isVisible) {
      setShouldRender(false);
      return;
    }
    // Show instantly for payment confirmation — no delay after Razorpay closes
    if (step === 'confirming') {
      setShouldRender(true);
      return;
    }
    // Delay showing to prevent flash on fast requests
    const timer = setTimeout(() => setShouldRender(true), SHOW_DELAY_MS);
    return () => clearTimeout(timer);
  }, [isVisible, step]);

  if (!shouldRender) return null;

  const currentIdx = STEPS.findIndex(s => s.key === step);
  const progress = ((currentIdx + 1) / STEPS.length) * 100;

  return (
    <div className="fixed inset-0 z-[100] bg-background/80 backdrop-blur-sm flex items-center justify-center safe-bottom">
      <div className="bg-card border border-border rounded-2xl p-6 mx-6 w-full max-w-sm shadow-lg">
        <div className="flex items-center justify-center mb-5">
          <ProgressRing progress={progress} />
        </div>
        <h3 className="text-base font-bold text-center mb-4">Processing payment</h3>
        <div className="space-y-3">
          {STEPS.map((s, idx) => {
            const Icon = s.icon;
            const isActive = idx === currentIdx;
            const isDone = idx < currentIdx;

            return (
              <div
                key={s.key}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-lg transition-all',
                  isActive && 'bg-primary/10',
                  isDone && 'opacity-60'
                )}
              >
                {isDone ? (
                  <CheckCircle size={18} className="text-primary shrink-0" />
                ) : isActive ? (
                  <div className="w-[18px] h-[18px] rounded-full border-2 border-primary border-t-transparent animate-spin shrink-0" />
                ) : (
                  <Icon size={18} className="text-muted-foreground shrink-0" />
                )}
                <span className={cn('text-sm', isActive ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground text-center mt-4">
          Please don't close this screen
        </p>
      </div>
    </div>
  );
}

export const OrderProgressOverlay = memo(OrderProgressOverlayInner);
