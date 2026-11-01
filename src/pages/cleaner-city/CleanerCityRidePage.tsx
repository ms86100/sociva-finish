// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useBlockUser,
  useCleanerCityRide,
  useCompleteRide,
  useConfirmCostShare,
  useCreateShareToken,
  useGenerateRideOtp,
  useMarkNoShow,
  useMeetupPoints,
  useProposeCostShare,
  useQuickMessages,
  useReportIncident,
  useReputation,
  useRideCostShares,
  useRideLocations,
  useSendQuickMessage,
  useSetMeetingPoint,
  useStartRide,
  useSubmitRating,
  useUpsertRideLocation,
} from '@/hooks/queries/useCleanerCity';
import { QUICK_MESSAGE_PHRASES } from '@/lib/cleaner-city/constants';
import { useAuth } from '@/contexts/AuthContext';
import {
  getCurrentPosition,
  requestBackgroundLocationPermission,
} from '@/lib/native-location';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';

export default function CleanerCityRidePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: ride, isLoading } = useCleanerCityRide(id);
  const { data: locations = [] } = useRideLocations(
    ride && ['pickup_pending', 'started'].includes(ride.status) ? id : null,
  );
  const { data: shares = [] } = useRideCostShares(id);
  const { data: meetupPoints = [] } = useMeetupPoints();
  const { data: quickMessages = [] } = useQuickMessages(id);
  const upsertLoc = useUpsertRideLocation();
  const report = useReportIncident();
  const shareToken = useCreateShareToken();
  const generateOtp = useGenerateRideOtp();
  const startRide = useStartRide();
  const completeRide = useCompleteRide();
  const submitRating = useSubmitRating();
  const proposeShare = useProposeCostShare();
  const confirmShare = useConfirmCostShare();
  const blockUser = useBlockUser();
  const setMeetingPoint = useSetMeetingPoint();
  const sendQuickMessage = useSendQuickMessage();
  const markNoShow = useMarkNoShow();
  const { isLoaded } = useGoogleMaps();

  const otherUserId =
    ride && user
      ? ride.host_user_id === user.id
        ? ride.guest_user_id
        : ride.host_user_id
      : null;
  const { data: rep } = useReputation(otherUserId);

  const [otp, setOtp] = useState('');
  const [shownOtp, setShownOtp] = useState('');
  const [stars, setStars] = useState(5);
  const [comment, setComment] = useState('');
  const [rupees, setRupees] = useState('50');
  const [fuelPrefilled, setFuelPrefilled] = useState(false);
  const [shareUrl, setShareUrl] = useState('');
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const [meetingLabel, setMeetingLabel] = useState('');
  const [backgroundSupported, setBackgroundSupported] = useState<boolean | null>(null);

  const isHost = ride?.host_user_id === user?.id;
  const active = ride && ['pickup_pending', 'started'].includes(ride.status);
  const canCoordinate = ride && ['confirmed', 'pickup_pending', 'started'].includes(ride.status);

  // Prefill fuel proposal from the ride's own estimate once, when it becomes available.
  useEffect(() => {
    if (fuelPrefilled || !ride) return;
    if (ride.estimated_fuel_paise != null) {
      setRupees(String(Math.max(1, Math.round(ride.estimated_fuel_paise / 100))));
      setFuelPrefilled(true);
    }
  }, [ride?.estimated_fuel_paise, fuelPrefilled]);

  // Live location publisher - keeps publishing on an interval while this page
  // is mounted and the ride is active. True background tracking depends on
  // the native build; we ask for it as a courtesy but never rely on it.
  useEffect(() => {
    if (!active || !id) return;
    let cancelled = false;

    if (Capacitor.isNativePlatform()) {
      requestBackgroundLocationPermission()
        .then((res) => {
          if (!cancelled) setBackgroundSupported(res.backgroundSupported);
        })
        .catch(() => {
          if (!cancelled) setBackgroundSupported(false);
        });
    } else {
      setBackgroundSupported(false);
    }

    const tick = async () => {
      try {
        const pos = await getCurrentPosition({ requestPermission: true });
        if (cancelled) return;
        await upsertLoc.mutateAsync({
          ride_id: id,
          latitude: pos.latitude,
          longitude: pos.longitude,
        });
      } catch {
        // GPS optional; do not spam toasts
      }
    };
    tick();
    const t = setInterval(tick, 10000);

    // Re-tick immediately on resume (foreground regain) so the map catches up
    // right away instead of waiting up to 10s - covers both native app
    // lifecycle and the web Visibility API.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    let removeAppListener: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      import('@capacitor/app')
        .then(({ App }) =>
          App.addListener('appStateChange', ({ isActive }) => {
            if (isActive) void tick();
          }),
        )
        .then((sub) => {
          removeAppListener = () => sub.remove();
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVisible);
      removeAppListener?.();
    };
  }, [active, id]);

  // Map render - recreate only when container/maps ready; update markers on location changes
  useEffect(() => {
    if (!isLoaded || !mapEl || !window.google?.maps) return;
    const map = new google.maps.Map(mapEl, {
      center: locations[0]
        ? { lat: Number(locations[0].latitude), lng: Number(locations[0].longitude) }
        : { lat: 12.9716, lng: 77.5946 },
      zoom: 14,
      disableDefaultUI: true,
      zoomControl: true,
    });
    const markers: google.maps.Marker[] = [];
    const paint = () => {
      markers.splice(0).forEach((m) => m.setMap(null));
      if (!locations.length) return;
      const bounds = new google.maps.LatLngBounds();
      locations.forEach((loc) => {
        const pos = { lat: Number(loc.latitude), lng: Number(loc.longitude) };
        markers.push(
          new google.maps.Marker({
            map,
            position: pos,
            label: loc.role === 'host' ? 'H' : 'G',
          }),
        );
        bounds.extend(pos);
      });
      if (locations.length > 1) map.fitBounds(bounds);
      else map.setCenter(bounds.getCenter());
    };
    paint();
    return () => {
      markers.forEach((m) => m.setMap(null));
    };
  }, [isLoaded, mapEl, locations]);

  const pendingShare = useMemo(
    () => shares.find((s: any) => s.status === 'proposed' && s.proposer_user_id !== user?.id),
    [shares, user?.id],
  );

  if (isLoading) {
    return (
      <AppLayout headerTitle="Ride">
        <CleanerCityGate>
          <p className="p-4 text-sm text-muted-foreground">Loading ride...</p>
        </CleanerCityGate>
      </AppLayout>
    );
  }

  if (!ride) {
    return (
      <AppLayout headerTitle="Ride">
        <CleanerCityGate>
          <div className="p-4 space-y-2">
            <p className="text-sm">Ride not found</p>
            <Link to="/cleaner-city/find" className="text-primary text-sm font-semibold">
              Back to find
            </Link>
          </div>
        </CleanerCityGate>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Active ride">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-ride-page">
          <div className="rounded-2xl border border-border bg-card p-4">
            <p className="text-sm font-semibold">
              {ride.travel_date} · {ride.status.replace(/_/g, ' ')}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {isHost ? 'You are host' : 'You are guest'}
              {rep?.avg_stars != null
                ? ` · partner ${rep.avg_stars}★ (${rep.rating_count})`
                : ''}
            </p>
            {ride.meeting_point_label && (
              <p
                className="text-xs text-primary font-semibold mt-2"
                data-testid="cleaner-city-meeting-point-label"
              >
                Meeting point: {ride.meeting_point_label}
              </p>
            )}
          </div>

          {canCoordinate && (
            <div
              className="rounded-2xl border border-border bg-card p-4 space-y-3"
              data-testid="cleaner-city-meeting-point-section"
            >
              <div>
                <p className="text-sm font-semibold">Meeting point</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Pick a clear spot so you do not miss each other.
                </p>
              </div>
              {meetupPoints.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {meetupPoints.map((pt) => (
                    <button
                      key={pt.id}
                      type="button"
                      onClick={async () => {
                        try {
                          await setMeetingPoint.mutateAsync({
                            ride_id: ride.id,
                            label: pt.label,
                            latitude: pt.latitude,
                            longitude: pt.longitude,
                          });
                          toast.success(`Meeting point set: ${pt.label}`);
                        } catch (e: any) {
                          toast.error(e?.message || 'Could not set meeting point');
                        }
                      }}
                      disabled={setMeetingPoint.isPending}
                      className="rounded-full border border-border px-3 py-1.5 text-xs font-semibold data-[active=true]:border-primary data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
                      data-active={ride.meeting_point_label === pt.label}
                      data-testid={`cleaner-city-meetup-point-${pt.id}`}
                    >
                      {pt.label}
                    </button>
                  ))}
                </div>
              )}
              {meetupPoints.length === 0 && (
                <p className="text-[11px] text-muted-foreground">
                  No society meetup points yet - use your current location instead.
                </p>
              )}
              <div className="flex gap-2">
                <Input
                  placeholder="Custom label (e.g. Gate 2)"
                  value={meetingLabel}
                  onChange={(e) => setMeetingLabel(e.target.value)}
                  className="h-9"
                />
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      const pos = await getCurrentPosition({ requestPermission: true });
                      await setMeetingPoint.mutateAsync({
                        ride_id: ride.id,
                        label: meetingLabel || 'My current location',
                        latitude: pos.latitude,
                        longitude: pos.longitude,
                      });
                      toast.success('Meeting point set from your location');
                      setMeetingLabel('');
                    } catch (e: any) {
                      toast.error(e?.message || 'Could not get location');
                    }
                  }}
                  disabled={setMeetingPoint.isPending}
                  data-testid="cleaner-city-meeting-point-gps"
                >
                  Use GPS
                </Button>
              </div>
            </div>
          )}

          {canCoordinate && (
            <div
              className="rounded-2xl border border-border bg-card p-4 space-y-3"
              data-testid="cleaner-city-quick-messages-section"
            >
              <p className="text-sm font-semibold">Quick message</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_MESSAGE_PHRASES.map((phrase) => (
                  <Button
                    key={phrase.key}
                    size="sm"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await sendQuickMessage.mutateAsync({
                          ride_id: ride.id,
                          phrase_key: phrase.key,
                        });
                        toast.success('Sent');
                      } catch (e: any) {
                        toast.error(e?.message || 'Could not send message');
                      }
                    }}
                    disabled={sendQuickMessage.isPending}
                    data-testid={`cleaner-city-quick-message-${phrase.key}`}
                  >
                    {phrase.label}
                  </Button>
                ))}
              </div>
              {quickMessages.length > 0 && (
                <div className="space-y-1.5 pt-1 border-t border-border">
                  {quickMessages.slice(0, 5).map((qm) => {
                    const phrase = QUICK_MESSAGE_PHRASES.find((p) => p.key === qm.phrase_key);
                    return (
                      <p key={qm.id} className="text-[11px] text-muted-foreground">
                        {qm.sender_user_id === user?.id ? 'You' : 'Partner'}: {phrase?.body || qm.phrase_key}
                      </p>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {['confirmed', 'pickup_pending'].includes(ride.status) && (
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  await markNoShow.mutateAsync({ ride_id: ride.id });
                  toast.success('Marked as no-show - seat released');
                } catch (e: any) {
                  toast.error(e?.message || 'Could not mark no-show');
                }
              }}
              data-testid="cleaner-city-mark-no-show"
            >
              Mark no-show
            </Button>
          )}

          {active && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">Live tracking</p>
              <div
                ref={setMapEl}
                className="h-52 w-full rounded-2xl border border-border bg-muted"
                data-testid="cleaner-city-ride-map"
              />
              <p className="text-[11px] text-muted-foreground">
                Location shared only with ride participants while the trip is active.
              </p>
              <p
                className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2"
                data-testid="cleaner-city-background-location-note"
              >
                {backgroundSupported
                  ? 'Background location is on - your partner can still see you if you switch apps briefly.'
                  : 'Keep Sociva open (or allow background location in phone settings) for live location to keep sharing while the trip is active.'}
              </p>
            </div>
          )}

          {isHost && ['confirmed', 'pickup_pending'].includes(ride.status) && (
            <Button
              onClick={async () => {
                try {
                  const res = await generateOtp.mutateAsync(ride.id);
                  setShownOtp(res.otp);
                  toast.success(`OTP ${res.otp}`);
                } catch (e: any) {
                  toast.error(e?.message || 'OTP failed');
                }
              }}
            >
              Generate pickup OTP
            </Button>
          )}
          {shownOtp && <p className="text-sm font-semibold text-primary">OTP {shownOtp}</p>}

          {ride.status === 'pickup_pending' && (
            <div className="flex gap-2">
              <Input placeholder="Enter OTP" value={otp} onChange={(e) => setOtp(e.target.value)} />
              <Button
                onClick={async () => {
                  try {
                    await startRide.mutateAsync({ ride_id: ride.id, otp });
                    toast.success('Ride started');
                  } catch (e: any) {
                    toast.error(e?.message || 'Invalid OTP');
                  }
                }}
              >
                Start
              </Button>
            </div>
          )}

          {isHost && ride.status === 'started' && (
            <Button
              onClick={async () => {
                try {
                  await completeRide.mutateAsync(ride.id);
                  toast.success('Completed');
                } catch (e: any) {
                  toast.error(e?.message || 'Failed');
                }
              }}
            >
              Complete ride
            </Button>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="destructive"
              onClick={async () => {
                try {
                  let lat = null;
                  let lng = null;
                  try {
                    const pos = await getCurrentPosition();
                    lat = pos.latitude;
                    lng = pos.longitude;
                  } catch {
                    /* optional */
                  }
                  await report.mutateAsync({
                    ride_id: ride.id,
                    incident_type: 'sos',
                    note: 'SOS from app',
                    latitude: lat,
                    longitude: lng,
                    severity: 'critical',
                  });
                  toast.success('SOS sent');
                } catch (e: any) {
                  toast.error(e?.message || 'SOS failed');
                }
              }}
              data-testid="cleaner-city-sos"
            >
              SOS
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const row = await shareToken.mutateAsync(ride.id);
                  const url = `${window.location.origin}/cleaner-city/share/${row.token}`;
                  setShareUrl(url);
                  await navigator.clipboard?.writeText(url);
                  toast.success('Share link copied');
                } catch (e: any) {
                  toast.error(e?.message || 'Share failed');
                }
              }}
            >
              Trip share
            </Button>
          </div>
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="cleaner-city-sos-explainer"
          >
            SOS is not a 112 or police dialer. It notifies your emergency contacts who have a
            Sociva account and the other person on this ride, and opens a trip share link they
            can view. For immediate danger, call 112 directly first.
          </p>
          {shareUrl && <p className="text-[11px] break-all text-muted-foreground">{shareUrl}</p>}

          {ride.status === 'completed' && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
              <p className="text-sm font-semibold">Rate & fuel share</p>
              <div className="flex gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={`h-9 w-9 rounded-full border text-sm font-semibold ${
                      stars === n ? 'border-primary bg-primary/10 text-primary' : 'border-border'
                    }`}
                    onClick={() => setStars(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <Input
                placeholder="Comment (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <Button
                onClick={async () => {
                  try {
                    await submitRating.mutateAsync({
                      ride_id: ride.id,
                      stars,
                      comment,
                    });
                    toast.success('Rating saved');
                  } catch (e: any) {
                    toast.error(e?.message || 'Rating failed');
                  }
                }}
              >
                Submit rating
              </Button>

              <div className="pt-2 border-t border-border space-y-2">
                <Label>Propose fuel share (INR)</Label>
                <Input
                  type="number"
                  min={0}
                  value={rupees}
                  onChange={(e) => setRupees(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  Ledger only - no wallet/Razorpay settlement yet (legal gate).
                </p>
                <Button
                  variant="outline"
                  onClick={async () => {
                    try {
                      const paise = Math.round(Number(rupees) * 100);
                      await proposeShare.mutateAsync({
                        ride_id: ride.id,
                        amount_paise: paise,
                      });
                      toast.success('Cost share proposed');
                    } catch (e: any) {
                      toast.error(e?.message || 'Failed');
                    }
                  }}
                >
                  Propose cost share
                </Button>
                {pendingShare && (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await confirmShare.mutateAsync({
                            cost_share_id: pendingShare.id,
                            accept: true,
                            ride_id: ride.id,
                          });
                          toast.success('Accepted on ledger');
                        } catch (e: any) {
                          toast.error(e?.message || 'Failed');
                        }
                      }}
                    >
                      Accept ₹{(pendingShare.amount_paise / 100).toFixed(0)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        try {
                          await confirmShare.mutateAsync({
                            cost_share_id: pendingShare.id,
                            accept: false,
                            ride_id: ride.id,
                          });
                          toast.success('Declined');
                        } catch (e: any) {
                          toast.error(e?.message || 'Failed');
                        }
                      }}
                    >
                      Decline
                    </Button>
                  </div>
                )}
              </div>

              {otherUserId && (
                <div className="space-y-1">
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={async () => {
                      try {
                        await blockUser.mutateAsync({ blocked_user_id: otherUserId });
                        toast.success('User blocked from future matches');
                      } catch (e: any) {
                        toast.error(e?.message || 'Block failed');
                      }
                    }}
                  >
                    Block this partner
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Changed your mind? Manage and unblock from{' '}
                    <Link to="/cleaner-city/safety" className="font-semibold underline">
                      Safety settings
                    </Link>
                    .
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
