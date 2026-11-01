// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useAppealDispute,
  useBlockUser,
  useCleanerCityRide,
  useCompleteRide,
  useConfirmCostShare,
  useCreateShareToken,
  useDisputeRide,
  useGenerateRideOtp,
  useMarkNoShow,
  useMeetupPoints,
  useOfficeLocations,
  useProposeCostShare,
  usePublicationRides,
  usePublicationStops,
  useQuickMessages,
  useRankedMeetupPoints,
  useReportIncident,
  useReputation,
  useRequestMaskedCall,
  useRideChat,
  useRideCostShares,
  useRideLocations,
  useSendQuickMessage,
  useSendRideChat,
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
import { enqueueLocation, flushLocationOutbox } from '@/lib/cleaner-city/locationOutbox';
import { startAndroidCommuteTracking, stopAndroidCommuteTracking } from '@/lib/cleaner-city/commuteTracking';
import {
  openGoogleMapsDirections,
  planDropSequence,
  type DropSequenceResult,
  type LatLng,
} from '@/lib/cleaner-city/routing';
import { openNativeRazorpayCheckout } from '@/lib/razorpay-native-checkout';
import { functionInvokeErrorMessage } from '@/lib/function-invoke-error';
import { supabase } from '@/integrations/supabase/client';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';

export default function CleanerCityRidePage() {
  const { id } = useParams();
  const location = useLocation();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';
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
  const disputeRide = useDisputeRide();
  const appealDispute = useAppealDispute();
  const maskedCall = useRequestMaskedCall();
  const { data: rankedMeetups = [] } = useRankedMeetupPoints(id);
  const { data: rideChat = [] } = useRideChat(id);
  const sendRideChat = useSendRideChat();
  const { data: offices = [] } = useOfficeLocations();
  const { data: publicationStops = [] } = usePublicationStops(ride?.publication_id || null);
  const { data: publicationRides = [] } = usePublicationRides(ride?.publication_id || null);
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
  const [chatBody, setChatBody] = useState('');
  const [appealNote, setAppealNote] = useState('');
  const [routeAccount, setRouteAccount] = useState('');
  const [fuelNotice, setFuelNotice] = useState('');
  const [fuelPaymentId, setFuelPaymentId] = useState('');
  const [dropPlan, setDropPlan] = useState<DropSequenceResult | null>(null);
  const [dropNav, setDropNav] = useState<{
    origin: LatLng;
    destination: LatLng;
    waypoints: LatLng[];
  } | null>(null);

  const isHost = ride?.host_user_id === user?.id;
  const active = ride && ['pickup_pending', 'started'].includes(ride.status);
  const canCoordinate = ride && ['confirmed', 'pickup_pending', 'started'].includes(ride.status);
  const needsMeetingPoint =
    !!ride &&
    ['confirmed', 'pickup_pending'].includes(ride.status) &&
    !ride.meeting_point_label;

  const siblingGuests = useMemo(() => {
    if (!ride?.publication_id) return [];
    return publicationRides.filter(
      (r) =>
        r.guest_dest_latitude != null &&
        r.guest_dest_longitude != null,
    );
  }, [publicationRides, ride?.publication_id]);

  // Prefill fuel proposal from the ride's own estimate once, when it becomes available.
  useEffect(() => {
    if (!ride?.id || !isHost || ride.status !== 'completed') return;
    let cancelled = false;
    supabase
      .from('ride_fuel_payments')
      .select('id, payout_status')
      .eq('ride_id', ride.id)
      .eq('status', 'paid')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled && data?.id && data.payout_status !== 'transferred') setFuelPaymentId(data.id);
      });
    return () => {
      cancelled = true;
    };
  }, [ride?.id, ride?.status, isHost]);

  useEffect(() => {
    if (fuelPrefilled || !ride) return;
    if (ride.estimated_fuel_paise != null) {
      setRupees(String(Math.max(1, Math.round(ride.estimated_fuel_paise / 100))));
      setFuelPrefilled(true);
    }
  }, [ride, ride?.estimated_fuel_paise, fuelPrefilled]);

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

    const sendSample = async (sample: { ride_id: string; latitude: number; longitude: number }) => {
      await upsertLoc.mutateAsync({
        ride_id: sample.ride_id,
        latitude: sample.latitude,
        longitude: sample.longitude,
      });
    };

    const tick = async () => {
      try {
        await flushLocationOutbox(sendSample);
        const pos = await getCurrentPosition({ requestPermission: true });
        if (cancelled) return;
        await sendSample({ ride_id: id, latitude: pos.latitude, longitude: pos.longitude });
      } catch {
        try {
          const pos = await getCurrentPosition({ requestPermission: false });
          enqueueLocation({
            ride_id: id,
            latitude: pos.latitude,
            longitude: pos.longitude,
            recorded_at: new Date().toISOString(),
          });
        } catch {
          // GPS optional; queued samples flush on the next successful tick
        }
      }
    };
    tick();
    const t = setInterval(tick, 10000);
    let watchId: string | null = null;
    if (Capacitor.isNativePlatform() && backgroundSupported) {
      import('@capacitor/geolocation')
        .then(({ Geolocation }) =>
          Geolocation.watchPosition({ enableHighAccuracy: true, timeout: 15000 }, (pos, err) => {
            if (cancelled || err || !pos) return;
            void sendSample({
              ride_id: id,
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
            }).catch(() => {
              enqueueLocation({
                ride_id: id,
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                recorded_at: new Date().toISOString(),
              });
            });
          }),
        )
        .then((idWatch) => {
          watchId = idWatch || null;
        })
        .catch(() => {});
    }

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
      if (watchId) {
        import('@capacitor/geolocation')
          .then(({ Geolocation }) => Geolocation.clearWatch({ id: watchId }))
          .catch(() => {});
      }
    };
  }, [active, id, backgroundSupported]);

  useEffect(() => {
    if (!active || !id || Capacitor.getPlatform() !== 'android') return;
    void startAndroidCommuteTracking(id).catch(() => {});
    return () => {
      void stopAndroidCommuteTracking();
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

  useEffect(() => {
    if (!ride || !isLoaded) {
      setDropPlan(null);
      setDropNav(null);
      return;
    }
    const guestStops = siblingGuests.map((g) => {
      const flat = (g as { guest_flat?: string | null }).guest_flat;
      const name = (g as { guest_name?: string | null }).guest_name;
      const who =
        flat && name
          ? `${name} · Flat ${flat}`
          : flat
            ? `Flat ${flat}`
            : name || (g.id === ride.id ? 'You' : 'Guest');
      return {
        id: `guest-${g.id}`,
        rideId: g.id,
        label: g.id === ride.id && !isHost ? `You (${who})` : who,
        lat: Number(g.guest_dest_latitude),
        lng: Number(g.guest_dest_longitude),
      };
    });
    const officeStops = publicationStops.map((s) => ({
      id: `stop-${s.id}`,
      rideId: null as string | null,
      label: s.label || `Office stop ${s.seq}`,
      lat: Number(s.latitude),
      lng: Number(s.longitude),
    }));
    const stops =
      guestStops.length >= 2
        ? guestStops
        : guestStops.length === 1 && officeStops.length >= 1
          ? [...guestStops, ...officeStops]
          : officeStops;

    if (stops.length < 2) {
      setDropPlan(null);
      setDropNav(null);
      return;
    }

    const office = offices.find((o) => o.is_primary) || offices[0] || null;
    const pickups = siblingGuests
      .map((g) =>
        g.guest_pickup_latitude != null && g.guest_pickup_longitude != null
          ? { lat: Number(g.guest_pickup_latitude), lng: Number(g.guest_pickup_longitude) }
          : null,
      )
      .filter(Boolean) as LatLng[];
    const origin =
      (ride.meeting_point_latitude != null && ride.meeting_point_longitude != null
        ? {
            lat: Number(ride.meeting_point_latitude),
            lng: Number(ride.meeting_point_longitude),
          }
        : null) ||
      pickups[0] ||
      (ride.guest_pickup_latitude != null && ride.guest_pickup_longitude != null
        ? {
            lat: Number(ride.guest_pickup_latitude),
            lng: Number(ride.guest_pickup_longitude),
          }
        : null);
    const destination =
      office != null
        ? { lat: Number(office.latitude), lng: Number(office.longitude) }
        : ride.guest_dest_latitude != null && ride.guest_dest_longitude != null
          ? {
              lat: Number(ride.guest_dest_latitude),
              lng: Number(ride.guest_dest_longitude),
            }
          : null;

    if (!origin || !destination) {
      setDropPlan(null);
      setDropNav(null);
      return;
    }

    let cancelled = false;
    void planDropSequence({
      origin,
      destination,
      stops: stops.map(({ id, label, lat, lng }) => ({ id, label, lat, lng })),
    }).then((plan) => {
      if (cancelled) return;
      setDropPlan(plan);
      setDropNav({
        origin,
        destination,
        waypoints: plan.ordered.map((s) => ({ lat: s.lat, lng: s.lng })),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [
    isHost,
    ride?.id,
    ride?.publication_id,
    ride?.meeting_point_latitude,
    ride?.meeting_point_longitude,
    siblingGuests,
    publicationStops,
    offices,
    isLoaded,
  ]);

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
          {arrivalNotice && (
            <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm">
              {arrivalNotice}
            </div>
          )}
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

          {dropPlan && dropPlan.ordered.length >= 2 && (
            <div
              className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3"
              data-testid="cleaner-city-drop-order"
            >
              <div>
                <p className="text-sm font-semibold">Drop order</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Google Maps order - follow this sequence
                  {dropPlan.durationSeconds
                    ? ` · ~${Math.round(dropPlan.durationSeconds / 60)} min`
                    : ''}
                  {dropPlan.provider === 'haversine_fallback' ? ' · approximate' : ''}
                </p>
                {!isHost && (() => {
                  const mine = dropPlan.ordered.find((s) => s.id === `guest-${ride.id}`);
                  return mine ? (
                    <p
                      className="text-sm font-semibold text-primary mt-2"
                      data-testid="cleaner-city-guest-drop-slot"
                    >
                      You are Drop {mine.dropIndex} of {dropPlan.ordered.length}
                    </p>
                  ) : null;
                })()}
              </div>
              {dropPlan.ordered.map((stop) => (
                <div
                  key={stop.id}
                  className="rounded-xl border border-border bg-card px-3.5 py-3"
                >
                  <p className="text-sm font-semibold">
                    Drop {stop.dropIndex} · {stop.label}
                  </p>
                </div>
              ))}
              {isHost && dropNav && (
                <Button
                  className="w-full h-11 font-semibold"
                  data-testid="cleaner-city-open-maps-drops"
                  onClick={() => openGoogleMapsDirections(dropNav)}
                >
                  Open in Google Maps
                </Button>
              )}
            </div>
          )}

          {needsMeetingPoint && (
            <div
              className="rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm"
              data-testid="cleaner-city-meeting-point-required"
            >
              <p className="font-semibold text-amber-900 dark:text-amber-100">
                Set a meeting point before starting
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Pick a clear spot below so nobody waits at the wrong gate.
              </p>
            </div>
          )}

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
              {rankedMeetups.length > 0 && (
                <div className="space-y-1" data-testid="cleaner-city-ranked-meetups">
                  <p className="text-[11px] font-semibold">Suggested from saved points</p>
                  {rankedMeetups.map((pt) => (
                    <button
                      key={pt.id}
                      type="button"
                      className="block w-full rounded-xl border border-border px-3 py-2 text-left text-xs"
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
                    >
                      {pt.label} · walk {Math.round(Number(pt.walk_meters) || 0)} m · about {pt.detour_minutes} min extra
                    </button>
                  ))}
                </div>
              )}
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
                {backgroundSupported && Capacitor.getPlatform() === 'android'
                  ? 'Android keeps a location notification for this ride, including while the screen is locked or Maps is in front. Points that fail to send stay on the phone and retry. iOS cannot keep a background location mode, so sharing there continues while Sociva stays open.'
                  : backgroundSupported
                  ? 'Background location is allowed on this phone. Sociva watches this ride while the system keeps the app running. Samples that fail to send are kept on this phone.'
                  : 'Keep Sociva open, or allow background location in phone settings, so live location can keep sharing. Samples that fail to send are kept on this phone and retry when the connection returns. iOS does not use a persistent background location mode.'}
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
            <div className="space-y-2">
              {needsMeetingPoint ? (
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Start is locked until a meeting point is set.
                </p>
              ) : null}
              <div className="flex gap-2">
                <Input placeholder="Enter OTP" value={otp} onChange={(e) => setOtp(e.target.value)} />
                <Button
                  disabled={needsMeetingPoint}
                  onClick={async () => {
                    if (needsMeetingPoint) {
                      toast.error('Set a meeting point before starting');
                      return;
                    }
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
                  const result: any = await report.mutateAsync({
                    ride_id: ride.id,
                    incident_type: 'sos',
                    note: 'SOS from app',
                    latitude: lat,
                    longitude: lng,
                    severity: 'critical',
                  });
                  const contacts = Number(result?.notified_contacts || 0);
                  const admins = Number(result?.notified_admins || 0);
                  const skipped = Number(result?.phone_only_contacts_skipped || 0);
                  const counterpart = result?.notified_counterpart ? 1 : 0;
                  if (contacts + admins + counterpart === 0) {
                    toast.message('SOS recorded', {
                      description:
                        'Incident saved. No in-app recipients were notified. Call 112 for immediate danger.',
                    });
                  } else {
                    toast.success(
                      `SOS alerted ${counterpart} ride partner, ${contacts} linked contact(s), ${admins} admin(s)` +
                        (skipped > 0
                          ? `. ${skipped} phone-only contact(s) were not messaged (no SMS).`
                          : ''),
                    );
                  }
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
            {['confirmed', 'pickup_pending', 'started'].includes(ride.status) && (
              <Button
                variant="outline"
                disabled={maskedCall.isPending}
                onClick={async () => {
                  try {
                    const res = await maskedCall.mutateAsync(ride.id);
                    if (res?.dispatch_error || res?.dispatch?.failed) {
                      toast.error('Relay call was queued, but calling is not configured yet');
                    } else {
                      toast.success('Relay call requested. Your number stays hidden.');
                    }
                  } catch (e: any) {
                    toast.error(e?.message || 'Could not start a relay call');
                  }
                }}
                data-testid="cleaner-city-masked-call"
              >
                Relay call
              </Button>
            )}
            {['no_show', 'completed', 'cancelled'].includes(ride.status) && (
              <Button
                variant="outline"
                disabled={disputeRide.isPending}
                onClick={async () => {
                  try {
                    await disputeRide.mutateAsync({ ride_id: ride.id });
                    toast.success('Dispute opened');
                  } catch (e: any) {
                    toast.error(e?.message || 'Could not open a dispute');
                  }
                }}
                data-testid="cleaner-city-dispute"
              >
                Dispute
              </Button>
            )}
            {ride.status === 'disputed' && (
              <div className="space-y-2" data-testid="cleaner-city-dispute-appeal">
                <Input
                  value={appealNote}
                  onChange={(e) => setAppealNote(e.target.value)}
                  placeholder="Why this dispute should be reviewed"
                />
                <Button
                  variant="outline"
                  disabled={appealDispute.isPending}
                  onClick={async () => {
                    try {
                      await appealDispute.mutateAsync({ ride_id: ride.id, note: appealNote });
                      toast.success('Appeal sent to admin');
                      setAppealNote('');
                    } catch (e: any) {
                      toast.error(e?.message || 'Could not appeal');
                    }
                  }}
                >
                  Appeal dispute
                </Button>
              </div>
            )}
            {['requested', 'confirmed', 'pickup_pending', 'started', 'completed'].includes(ride.status) && (
              <div className="space-y-2" data-testid="cleaner-city-ride-chat">
                <p className="text-sm font-semibold">Ride chat</p>
                <Link to={`/cleaner-city/chat?thread=ride:${ride.id}`} className="text-xs font-semibold text-primary">
                  Open the full chat
                </Link>
                {rideChat.slice(-8).map((row) => (
                  <p key={row.id} className="text-[11px] text-muted-foreground">
                    {row.sender_id === user?.id ? 'You' : 'Partner'}: {row.body}
                  </p>
                ))}
                <div className="flex gap-2">
                  <Input
                    value={chatBody}
                    onChange={(e) => setChatBody(e.target.value)}
                    placeholder="Message about this ride"
                  />
                  <Button
                    variant="outline"
                    disabled={!chatBody.trim() || !ride.society_id || sendRideChat.isPending}
                    onClick={async () => {
                      try {
                        await sendRideChat.mutateAsync({
                          ride_id: ride.id,
                          society_id: ride.society_id,
                          body: chatBody,
                        });
                        setChatBody('');
                      } catch (e: any) {
                        toast.error(e?.message || 'Could not send');
                      }
                    }}
                  >
                    Send
                  </Button>
                </div>
              </div>
            )}
          </div>
          <p
            className="text-[11px] text-muted-foreground"
            data-testid="cleaner-city-sos-explainer"
          >
            SOS records an incident and notifies the other person on this ride, linked emergency contacts,
            and society admins in the app. Phone contacts are queued for SMS, which sends only
            when Sociva's SMS template is configured. Failed alerts can be retried from Safety.
            Live location keeps a watch while this ride is active and the phone allows it.
            If the connection drops, samples stay on this phone and send when it returns.
            If the system stops the app, sharing resumes when you open Sociva. This is not a 112 dialer.
            For immediate danger, call 112 first.
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
                  The guest pays the agreed amount through Razorpay. The host balance is recorded as payable. A bank transfer waits until a Razorpay route account is linked.
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
                {ride.status === 'completed' && !isHost && (
                  <Button
                    variant="outline"
                    data-testid="cleaner-city-pay-fuel"
                    onClick={async () => {
                      try {
                        const { data, error } = await supabase.functions.invoke('cleaner-city-fuel-order', {
                          body: { ride_id: ride.id },
                        });
                        if (error || data?.error) {
                          throw new Error(await functionInvokeErrorMessage({ error, data }));
                        }
                        if (!data?.key_id || !data?.razorpay_order_id) {
                          throw new Error('Payment could not start.');
                        }
                        await openNativeRazorpayCheckout({
                          key: data.key_id,
                          amount: data.amount_paise,
                          currency: 'INR',
                          name: 'Sociva',
                          description: 'Cleaner City fuel share',
                          order_id: data.razorpay_order_id,
                          handler: async (response) => {
                            const confirm = await supabase.functions.invoke('cleaner-city-confirm-fuel', {
                              body: {
                                payment_id: data.payment_id,
                                razorpay_payment_id: response.razorpay_payment_id,
                                razorpay_order_id: response.razorpay_order_id,
                                razorpay_signature: response.razorpay_signature,
                              },
                            });
                            if (confirm.error || confirm.data?.error) {
                              toast.error(confirm.data?.error || 'Payment could not be confirmed');
                              return;
                            }
                            toast.success('Fuel share paid. Host payout is recorded as payable.');
                          },
                        });
                      } catch (e: any) {
                        toast.error(e?.message || 'Could not start fuel payment');
                      }
                    }}
                  >
                    Pay fuel share
                  </Button>
                )}
                {ride.status === 'completed' && isHost && (
                  <div className="rounded-xl border border-border p-3 space-y-2" data-testid="cleaner-city-fuel-payout">
                    <p className="text-sm font-semibold">Send fuel to your bank</p>
                    <p className="text-xs text-muted-foreground">
                      This stays payable until a Razorpay route account is linked. Sociva does not mark it paid out before Razorpay accepts the transfer.
                    </p>
                    <Input
                      placeholder="acct_..."
                      value={routeAccount}
                      onChange={(e) => setRouteAccount(e.target.value)}
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          try {
                            const { error } = await supabase.rpc('cleaner_city_link_payout_account', {
                              p_account_id: routeAccount,
                            });
                            if (error) throw error;
                            setFuelNotice(routeAccount.trim()
                              ? 'Route account saved. Send the captured fuel share when the guest has paid.'
                              : 'Route account cleared. Fuel stays payable.');
                          } catch (e: any) {
                            toast.error(e?.message || 'Could not save the route account');
                          }
                        }}
                      >
                        Save route account
                      </Button>
                      <Button
                        size="sm"
                        onClick={async () => {
                          if (!fuelPaymentId) {
                            setFuelNotice('No captured fuel payment on this ride yet.');
                            return;
                          }
                          try {
                            const { data, error } = await supabase.functions.invoke('cleaner-city-settle-fuel', {
                              body: { payment_id: fuelPaymentId },
                            });
                            if (error || data?.error) {
                              throw new Error(data?.error || (await functionInvokeErrorMessage({ error, data })));
                            }
                            setFuelNotice(data?.payout_status === 'transferred'
                              ? 'Razorpay accepted the transfer to your route account.'
                              : 'The transfer is not finished. It stays payable.');
                          } catch (e: any) {
                            setFuelNotice(e?.message || 'The bank transfer did not start.');
                          }
                        }}
                      >
                        Transfer fuel
                      </Button>
                    </div>
                    {fuelNotice && <p className="text-xs text-primary">{fuelNotice}</p>}
                  </div>
                )}
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
