import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { FinancialControlsSnapshot } from '@/lib/financial-controls';
import { buildPayoutEnablementSteps } from '@/lib/financial-controls';
import { Check, Circle } from 'lucide-react';

export function PayoutEnablementChecklist({
  snapshot,
  onRequestStep,
  busy,
}: {
  snapshot: FinancialControlsSnapshot;
  onRequestStep: (controlType: 'feature_flag' | 'configuration', key: string, value: string) => void;
  busy?: boolean;
}) {
  const steps = buildPayoutEnablementSteps(snapshot);
  const complete = steps.every((s) => s.done);
  const preflight = snapshot.preflight || {};
  const payoutRailReady = preflight.payout_ready === true;

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm">Enable automated seller payouts</CardTitle>
          <Badge variant={complete && payoutRailReady ? 'default' : 'secondary'}>
            {complete && payoutRailReady ? 'Ready' : 'Incomplete'}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Complete in order. Each step uses maker-checker — you request, a different admin approves.
        </p>
        <ol className="space-y-2">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className="flex items-start gap-3 rounded-lg border border-border/60 p-3"
            >
              <div className="mt-0.5 shrink-0">
                {step.done ? (
                  <Check size={16} className="text-emerald-600" />
                ) : (
                  <Circle size={16} className="text-muted-foreground" />
                )}
              </div>
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {index + 1}. {step.label}
                </p>
                <p className="text-[11px] text-muted-foreground">{step.detail}</p>
                {!step.done && step.pending && (
                  <Badge variant="secondary" className="text-[10px]">
                    Pending approval
                  </Badge>
                )}
              </div>
              {!step.done && !step.pending && step.request && (
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0"
                  disabled={busy || (index > 0 && !steps[index - 1]?.done)}
                  onClick={() =>
                    onRequestStep(step.request!.controlType, step.request!.key, step.request!.value)
                  }
                >
                  Request
                </Button>
              )}
            </li>
          ))}
        </ol>
        {!payoutRailReady && (
          <p className="text-[11px] text-warning">
            Payout rail preflight is not ready — verify Razorpay credentials and settlement functions before enabling.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
