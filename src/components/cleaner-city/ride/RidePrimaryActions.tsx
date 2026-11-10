// @ts-nocheck
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { RideMission } from '@/hooks/queries/useCleanerCity';

type Props = {
  ride: RideMission;
  isHost: boolean;
  needsMeetingPoint: boolean;
  otp: string;
  shownOtp: string;
  onOtpChange: (v: string) => void;
  accepting?: boolean;
  declining?: boolean;
  cancelling?: boolean;
  generatingOtp?: boolean;
  starting?: boolean;
  completing?: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onCancel: () => void;
  onGenerateOtp: () => void;
  onStart: () => void;
  onComplete: () => void;
  onScrollToMeeting?: () => void;
  onScrollToChat?: () => void;
  onScrollToRate?: () => void;
  onOpenMaps?: (() => void) | null;
  meetingPickerSlot?: ReactNode;
  /** Host has guest drops still pending - hide Complete; drop card owns the flow. */
  awaitingDrops?: boolean;
};

export function RidePrimaryActions({
  ride,
  isHost,
  needsMeetingPoint,
  otp,
  shownOtp,
  onOtpChange,
  accepting,
  declining,
  cancelling,
  generatingOtp,
  starting,
  completing,
  onAccept,
  onDecline,
  onCancel,
  onGenerateOtp,
  onStart,
  onComplete,
  onScrollToMeeting,
  onScrollToChat,
  onScrollToRate,
  onOpenMaps,
  meetingPickerSlot,
  awaitingDrops,
}: Props) {
  const [confirmComplete, setConfirmComplete] = useState(false);

  if (ride.status === 'requested') {
    if (isHost) {
      return (
        <section
          className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
          data-testid="cleaner-city-ride-primary-actions"
        >
          <p className="text-sm font-semibold">New seat request</p>
          <div className="grid grid-cols-2 gap-2">
            <Button className="h-12 font-semibold" disabled={accepting} onClick={onAccept}>
              Accept
            </Button>
            <Button
              className="h-12 font-semibold"
              variant="outline"
              disabled={declining}
              onClick={onDecline}
            >
              Decline
            </Button>
          </div>
        </section>
      );
    }
    return (
      <section
        className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">Waiting for host</p>
        <div className="grid grid-cols-2 gap-2">
          <Button className="h-12 font-semibold" variant="outline" onClick={onScrollToChat}>
            Message
          </Button>
          <Button
            className="h-12 font-semibold"
            variant="outline"
            disabled={cancelling}
            onClick={onCancel}
          >
            Cancel seat
          </Button>
        </div>
      </section>
    );
  }

  if (ride.status === 'confirmed' || ride.status === 'pickup_pending') {
    const atPickup = ride.status === 'pickup_pending';
    return (
      <section
        className="space-y-3 rounded-2xl border border-emerald-800/20 bg-emerald-50/70 p-4 dark:bg-emerald-950/20"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">
          {needsMeetingPoint ? 'Confirm meet spot' : atPickup ? 'Enter pickup code' : 'Pickup'}
        </p>

        {needsMeetingPoint ? (
          <div className="space-y-2">
            {meetingPickerSlot ? (
              <div data-testid="cleaner-city-inline-meeting">{meetingPickerSlot}</div>
            ) : (
              <Button className="h-12 w-full font-semibold" onClick={onScrollToMeeting}>
                Open meet spot
              </Button>
            )}
          </div>
        ) : null}

        {!needsMeetingPoint && isHost ? (
          <div className="space-y-3" data-testid="cleaner-city-host-code-panel">
            <div className="flex gap-2">
              <Input
                className="h-12 font-semibold tracking-[0.2em]"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Guest's 6-digit code"
                value={otp}
                onChange={(e) => onOtpChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                data-testid="cleaner-city-host-otp-input"
              />
              <Button
                className="h-12 px-5 font-semibold"
                disabled={!atPickup || starting || otp.length < 6}
                onClick={onStart}
                data-testid="cleaner-city-start-with-otp"
              >
                Start
              </Button>
            </div>
            {!atPickup ? (
              <p className="text-[11px] text-muted-foreground">
                Waiting for guest code at the meet spot.
              </p>
            ) : null}
            {onOpenMaps ? (
              <Button className="h-11 w-full font-semibold" variant="outline" onClick={onOpenMaps}>
                Open in Google Maps
              </Button>
            ) : null}
          </div>
        ) : null}

        {!needsMeetingPoint && !isHost ? (
          <div className="space-y-3">
            {shownOtp ? (
              <div
                id="cleaner-city-passenger-otp-display"
                className="rounded-2xl border border-[#0F3D2E]/15 bg-[#E8F2EC] px-4 py-6 text-center"
                data-testid="cleaner-city-passenger-otp-display"
              >
                <p className="text-[12px] font-semibold text-[#0F3D2E]">
                  Show this code to your host at pickup
                </p>
                <p className="mt-3 text-[36px] font-bold tracking-[0.28em] text-[#0F3D2E]">{shownOtp}</p>
                <p className="mt-2 text-[11px] text-muted-foreground">Secure · One-time use</p>
              </div>
            ) : (
              <Button
                className="h-12 w-full rounded-2xl bg-[#0F3D2E] font-semibold text-white hover:bg-[#0C3226]"
                disabled={generatingOtp}
                onClick={onGenerateOtp}
                data-testid="cleaner-city-generate-otp"
              >
                Create pickup code
              </Button>
            )}
            {shownOtp ? (
              <Button
                className="h-12 w-full rounded-2xl bg-[#0F3D2E] font-semibold text-white hover:bg-[#0C3226]"
                onClick={() => {
                  document
                    .getElementById('cleaner-city-passenger-otp-display')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
                data-testid="cleaner-city-show-code-cta"
              >
                Show code to host →
              </Button>
            ) : null}
            {shownOtp ? (
              <Button
                className="h-10 w-full font-semibold"
                variant="ghost"
                disabled={generatingOtp}
                onClick={onGenerateOtp}
              >
                New code
              </Button>
            ) : null}
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground">
              Your ride is safe, verified and community-backed.
            </p>
          </div>
        ) : null}

        <Button
          className="h-10 w-full font-semibold"
          variant="ghost"
          disabled={cancelling}
          onClick={onCancel}
        >
          Cancel seat
        </Button>
      </section>
    );
  }

  if (ride.status === 'started' && isHost) {
    // Drop card owns navigate / arrived / guest-off. Don't compete with it.
    if (awaitingDrops) return null;

    return (
      <section
        className="space-y-3 rounded-2xl border border-emerald-800/20 bg-emerald-50/80 p-4"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">Ready to finish</p>
        {confirmComplete ? (
          <div
            className="space-y-2 rounded-xl border border-border bg-background/70 p-3"
            data-testid="cleaner-city-complete-confirm"
          >
            <p className="text-sm font-semibold">Close this ride?</p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                className="h-11 font-semibold"
                disabled={completing}
                onClick={onComplete}
                data-testid="cleaner-city-complete-confirm-yes"
              >
                Yes, complete
              </Button>
              <Button
                className="h-11 font-semibold"
                variant="outline"
                onClick={() => setConfirmComplete(false)}
              >
                Not yet
              </Button>
            </div>
          </div>
        ) : (
          <Button
            className="h-12 w-full font-extrabold bg-emerald-800 hover:bg-emerald-900"
            disabled={completing}
            onClick={() => setConfirmComplete(true)}
            data-testid="cleaner-city-complete-ride"
          >
            Complete ride
          </Button>
        )}
      </section>
    );
  }

  if (ride.status === 'started') {
    return (
      <section
        className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">On the way</p>
        <Button className="h-12 w-full font-semibold" onClick={onScrollToChat}>
          Message host
        </Button>
      </section>
    );
  }

  if (ride.status === 'completed') {
    return (
      <section
        className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">Ride complete</p>
        <p className="text-xs text-muted-foreground">Rate your partner in More.</p>
        <Button
          className="h-12 w-full font-semibold"
          onClick={() => onScrollToRate?.()}
          data-testid="cleaner-city-rate-prompt"
        >
          Rate partner
        </Button>
      </section>
    );
  }

  return null;
}
