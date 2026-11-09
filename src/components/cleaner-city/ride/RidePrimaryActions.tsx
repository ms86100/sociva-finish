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
  onOpenMaps?: (() => void) | null;
  meetingPickerSlot?: ReactNode;
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
  meetingPickerSlot,
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

  if (ride.status === 'confirmed') {
    return (
      <section
        className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">Seat confirmed</p>
        {needsMeetingPoint ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              Set the meeting point here - no need to hunt elsewhere.
            </p>
            {meetingPickerSlot ? (
              <div data-testid="cleaner-city-inline-meeting">{meetingPickerSlot}</div>
            ) : (
              <Button className="h-12 w-full font-semibold" onClick={onScrollToMeeting}>
                Set meeting point
              </Button>
            )}
          </div>
        ) : isHost ? (
          <p className="text-xs text-muted-foreground">
            Meet at the point below. Your passenger creates a 6-digit code when they arrive -
            you type it to start.
          </p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              At the gate, tap once to create your pickup code. Show it only to your rider.
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
              Ask your passenger for their 6-digit code at the meeting point, then start.
            </p>
            {needsMeetingPoint ? (
              <div className="space-y-2">
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Start unlocks after a meeting point is set.
                </p>
                {meetingPickerSlot ? (
                  <div data-testid="cleaner-city-inline-meeting">{meetingPickerSlot}</div>
                ) : (
                  <Button className="h-11 w-full font-semibold" variant="outline" onClick={onScrollToMeeting}>
                    Set meeting point
                  </Button>
                )}
              </div>
            ) : null}
            <div className="flex gap-2">
              <Input
                className="h-12 tracking-[0.2em] font-semibold"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="6-digit code"
                value={otp}
                onChange={(e) => onOtpChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
                data-testid="cleaner-city-host-otp-input"
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
            {onOpenMaps ? (
              <Button className="h-11 w-full font-semibold" variant="outline" onClick={onOpenMaps}>
                Open in Google Maps
              </Button>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Show this code to your rider. They type it to start - you do not enter it.
            </p>
            {shownOtp ? (
              <div
                className="rounded-2xl border border-primary/30 bg-background/60 px-4 py-5 text-center"
                data-testid="cleaner-city-passenger-otp-display"
              >
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Show to rider
                </p>
                <p className="mt-2 text-3xl font-extrabold tracking-[0.35em] text-primary">
                  {shownOtp}
                </p>
              </div>
            ) : (
              <Button
                className="h-12 w-full font-semibold"
                disabled={generatingOtp}
                onClick={onGenerateOtp}
                data-testid="cleaner-city-generate-otp"
              >
                Create pickup code
              </Button>
            )}
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
            <p className="text-center text-xs text-muted-foreground">
              Waiting for your rider to enter the code…
            </p>
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
        {confirmComplete ? (
          <div
            className="space-y-2 rounded-xl border border-border bg-background/70 p-3"
            data-testid="cleaner-city-complete-confirm"
          >
            <p className="text-sm font-semibold">Passengers dropped?</p>
            <p className="text-xs text-muted-foreground">
              Confirm seats are done before closing the ride.
            </p>
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
            className="h-12 w-full font-semibold"
            disabled={completing}
            onClick={() => setConfirmComplete(true)}
            data-testid="cleaner-city-complete-ride"
          >
            Complete ride
          </Button>
        )}
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

  if (ride.status === 'completed') {
    return (
      <section
        className="rounded-2xl border border-primary/40 bg-primary/10 p-4 space-y-3"
        data-testid="cleaner-city-ride-primary-actions"
      >
        <p className="text-sm font-semibold">Ride complete</p>
        <p className="text-xs text-muted-foreground">
          Rate your partner below when you are ready - it helps the next commute.
        </p>
        <Button
          className="h-12 w-full font-semibold"
          onClick={() =>
            document
              .getElementById('cleaner-city-rate-section')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
          data-testid="cleaner-city-rate-prompt"
        >
          Rate partner
        </Button>
      </section>
    );
  }

  return null;
}
