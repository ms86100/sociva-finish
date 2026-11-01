// @ts-nocheck
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
  onOpenMaps?: (() => void) | null;
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
  onOpenMaps,
}: Props) {
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

  if (ride.status === 'confirmed') {
    return (
      <section
        className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">Seat confirmed</p>
        {needsMeetingPoint ? (
          <Button className="h-12 w-full font-semibold" onClick={onScrollToMeeting}>
            Set meeting point
          </Button>
        ) : isHost ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              At the gate, tap once to create a pickup code for your guest.
            </p>
            <Button
              className="h-12 w-full font-semibold"
              disabled={generatingOtp}
              onClick={onGenerateOtp}
              data-testid="cleaner-city-generate-otp"
            >
              Create pickup code
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Meet at the point below. Your host will share a 6-digit code when you arrive.
          </p>
        )}
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

  if (ride.status === 'pickup_pending') {
    return (
      <section
        className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">Pickup code</p>
        {isHost ? (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Show this code to your guest. They type it to start the trip - you do not enter it.
            </p>
            <Button
              className="h-12 w-full font-semibold"
              disabled={generatingOtp}
              onClick={onGenerateOtp}
              data-testid="cleaner-city-generate-otp"
            >
              {shownOtp ? 'New code' : 'Create pickup code'}
            </Button>
            {shownOtp ? (
              <div
                className="rounded-2xl border border-primary/30 bg-background/60 px-4 py-5 text-center"
                data-testid="cleaner-city-host-otp-display"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Show to guest
                </p>
                <p className="mt-2 text-3xl font-extrabold tracking-[0.35em] text-primary">
                  {shownOtp}
                </p>
              </div>
            ) : null}
            <p className="text-center text-xs text-muted-foreground">
              Waiting for guest to enter the code…
            </p>
            {onOpenMaps ? (
              <Button className="h-11 w-full font-semibold" variant="outline" onClick={onOpenMaps}>
                Open in Google Maps
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Ask your host for the 6-digit code at the meeting point, then start.
            </p>
            {needsMeetingPoint ? (
              <p className="text-xs text-amber-700 dark:text-amber-300">
                Start unlocks after a meeting point is set.
              </p>
            ) : null}
            <div className="flex gap-2">
              <Input
                className="h-12 tracking-[0.2em] font-semibold"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => onOtpChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                data-testid="cleaner-city-guest-otp-input"
              />
              <Button
                className="h-12 px-5 font-semibold"
                disabled={needsMeetingPoint || starting || otp.length < 6}
                onClick={onStart}
                data-testid="cleaner-city-start-with-otp"
              >
                Start
              </Button>
            </div>
          </div>
        )}
      </section>
    );
  }

  if (ride.status === 'started' && isHost) {
    return (
      <section
        className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">On the road</p>
        <Button className="h-12 w-full font-semibold" disabled={completing} onClick={onComplete}>
          Complete ride
        </Button>
        {onOpenMaps ? (
          <Button className="h-11 w-full font-semibold" variant="outline" onClick={onOpenMaps}>
            Open in Google Maps
          </Button>
        ) : null}
      </section>
    );
  }

  if (ride.status === 'started') {
    return (
      <section
        className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">On the road</p>
        <Button className="h-12 w-full font-semibold" onClick={onScrollToChat}>
          Message host
        </Button>
      </section>
    );
  }

  return null;
}
