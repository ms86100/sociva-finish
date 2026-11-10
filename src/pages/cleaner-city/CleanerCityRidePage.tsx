// @ts-nocheck
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CleanerCityChrome } from '@/components/cleaner-city/CleanerCityChrome';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useAppealDispute,
  useBlockUser,
  useCancelRide,
  useCleanerCityRide,
  useCompleteRide,
  useCleanerCityCapabilities,
  useConfirmCostShare,
  useCreateShareToken,
  useDispatchSafetyAlerts,
  useDisputeRide,
  useGenerateRideOtp,
  useMarkNoShow,
  useMeetupPoints,
  useOfficeLocations,
  usePublicationRides,
  useSetPublicationDropOrder,
  useQuickMessages,
  useRankedMeetupPoints,
  useReportIncident,
  useReputation,
  useRequestMaskedCall,
  useRespondRideRequest,
  useRevokeShareToken,
  useRideChat,
  useRideCostShares,
  useRideDisputeCase,
  useRideLifecycleEvents,
  useRideLocations,
  useSendQuickMessage,
  useSendRideChat,
  useSetMeetingPoint,
  useStartRide,
  useSubmitRating,
  useUpsertRideLocation,
} from '@/hooks/queries/useCleanerCity';
import { RideMissionHero } from '@/components/cleaner-city/ride/RideMissionHero';
import { RidePrimaryActions } from '@/components/cleaner-city/ride/RidePrimaryActions';
import { RideQuickActions } from '@/components/cleaner-city/ride/RideQuickActions';
import { RideChatStrip } from '@/components/cleaner-city/ride/RideChatStrip';
import { DropRunPanel } from '@/components/cleaner-city/ride/DropRunPanel';
import { RideFindEachOther } from '@/components/cleaner-city/ride/RideFindEachOther';
import {
  RideWorkspaceTabs,
  type RideWorkspaceTab,
} from '@/components/cleaner-city/ride/RideWorkspaceTabs';
import { CleanerCityMeetingPointPicker } from '@/components/cleaner-city/CleanerCityMeetingPointPicker';
import { CallButton } from '@/components/calling/CallButton';
import { QUICK_MESSAGE_PHRASES } from '@/lib/cleaner-city/constants';
import { resolveCleanerCityRideCall } from '@/lib/calling/resolveCallContext';
import {
  fetchVoipCapabilities,
  startVoipCall,
  type VoipCapabilities,
} from '@/lib/calling/CallManager';
import {
  canOpenDispute,
  canShowRideSos,
  canShowTripShare,
  formatCountdown,
  formatStraightLineDistance,
  locationFreshnessLabel,
  locationFreshnessTone,
  rideLifecycleEventLabel,
} from '@/lib/cleaner-city/rideMissionCopy';
import {
  buildDropOrderPayload,
  parseDropOrderJson,
  preferDropProgress,
  withUpdatedStopProgress,
  type DropOrderPersisted,
  type DropProgressStatus,
} from '@/lib/cleaner-city/dropRun';
import { useAuth } from '@/contexts/AuthContext';
import { getCurrentPosition } from '@/lib/native-location';
import { useCleanerCityRideTracking } from '@/hooks/useCleanerCityRideTracking';
import {
  decodePolyline,
  haversineMeters,
  openGoogleMapsDirections,
  planDropSequence,
  type LatLng,
} from '@/lib/cleaner-city/routing';
import { suggestSmartMeetSpot } from '@/lib/cleaner-city/meetSuggest';
import { openNativeRazorpayCheckout } from '@/lib/razorpay-native-checkout';
import { functionInvokeErrorMessage } from '@/lib/function-invoke-error';
import { supabase } from '@/integrations/supabase/client';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';

export default function CleanerCityRidePage() {
  const { id } = useParams();
  const location = useLocation();
  const queryClient = useQueryClient();
  const arrivalNotice = (location.state as { notice?: string } | null)?.notice || '';
  const { user } = useAuth();
  const { data: rideData, isLoading } = useCleanerCityRide(id);
  const seededRide = (location.state as { seededRide?: NonNullable<typeof rideData> } | null)
    ?.seededRide;
  const ride = rideData || (seededRide?.id === id ? seededRide : null);
  const { data: locations = [] } = useRideLocations(
    ride && ['confirmed', 'pickup_pending', 'started'].includes(ride.status) ? id : null,
  );
  const { data: shares = [] } = useRideCostShares(id);
  const { data: meetupPoints = [] } = useMeetupPoints();
  const { data: quickMessages = [] } = useQuickMessages(id);
  const { data: lifecycleEvents = [] } = useRideLifecycleEvents(id);
  const { data: capabilities } = useCleanerCityCapabilities();
  const requestMaskedCall = useRequestMaskedCall();
  const upsertLoc = useUpsertRideLocation();
  const report = useReportIncident();
  const dispatchSafety = useDispatchSafetyAlerts();
  const relayCallReady = capabilities?.relay_call === true;
  const [voipCaps, setVoipCaps] = useState<VoipCapabilities | null>(null);
  const voipCallReady = voipCaps?.can_place_calls === true;
  const shareToken = useCreateShareToken();
  const revokeShare = useRevokeShareToken();
  const generateOtp = useGenerateRideOtp();
  const startRide = useStartRide();
  const completeRide = useCompleteRide();
  const submitRating = useSubmitRating();
  const confirmShare = useConfirmCostShare();
  const blockUser = useBlockUser();
  const setMeetingPoint = useSetMeetingPoint();
  const sendQuickMessage = useSendQuickMessage();
  const markNoShow = useMarkNoShow();
  const disputeRide = useDisputeRide();
  const appealDispute = useAppealDispute();
  const { data: disputeCase } = useRideDisputeCase(
    ride && ['disputed', 'completed', 'no_show', 'cancelled'].includes(ride.status) ? id : null,
  );
  const respond = useRespondRideRequest();
  const cancelRide = useCancelRide();
  const { data: rankedMeetups = [] } = useRankedMeetupPoints(id);
  const { data: rideChat = [] } = useRideChat(id);
  const sendRideChat = useSendRideChat();
  const { data: offices = [] } = useOfficeLocations();
  const { data: publicationRides = [] } = usePublicationRides(ride?.publication_id || null);
  const setDropOrder = useSetPublicationDropOrder();
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
  const [shareUrl, setShareUrl] = useState('');
  const [shareExpiresAt, setShareExpiresAt] = useState('');
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);
  const [meetingLabel, setMeetingLabel] = useState('');
  const [chatBody, setChatBody] = useState('');
  const [appealNote, setAppealNote] = useState('');
  const [disputeNote, setDisputeNote] = useState('');
  const [mapDistanceLabel, setMapDistanceLabel] = useState<string | null>(null);
  const [sosResult, setSosResult] = useState<{
    contacts: number;
    admins: number;
    counterpart: number;
    skipped: number;
  } | null>(null);
  const [routeAccount, setRouteAccount] = useState('');
  const [fuelNotice, setFuelNotice] = useState('');
  const [fuelPaymentId, setFuelPaymentId] = useState('');
  const [dropOrderState, setDropOrderState] = useState<DropOrderPersisted | null>(null);
  const dropOrderStateRef = useRef<DropOrderPersisted | null>(null);
  dropOrderStateRef.current = dropOrderState;
  const [dropNav, setDropNav] = useState<{
    origin: LatLng;
    destination: LatLng;
    waypoints: LatLng[];
  } | null>(null);
  const [dropGps, setDropGps] = useState<LatLng | null>(null);
  const [markingStopId, setMarkingStopId] = useState<string | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [clockTick, setClockTick] = useState(0);
  const [sosConfirmOpen, setSosConfirmOpen] = useState(false);
  const [rideTab, setRideTab] = useState<RideWorkspaceTab>('trip');
  const [heroCallBusy, setHeroCallBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchVoipCapabilities()
      .then((caps) => {
        if (!cancelled) setVoipCaps(caps);
      })
      .catch(() => {
        if (!cancelled) {
          setVoipCaps({
            enabled: false,
            livekit_configured: false,
            apple_voip_push_configured: false,
            android_voip_push_configured: true,
            can_place_calls: false,
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [sharingLivePin, setSharingLivePin] = useState(false);

  const isHost = ride?.host_user_id === user?.id;
  const active = !!ride && ['pickup_pending', 'started'].includes(ride.status);
  const canCoordinate = ride && ['confirmed', 'pickup_pending', 'started'].includes(ride.status);
  const trackingStatus = useCleanerCityRideTracking(
    active ? id : null,
    active,
    async (sample) => {
      try {
        await upsertLoc.mutateAsync({
          ride_id: sample.ride_id,
          latitude: sample.latitude,
          longitude: sample.longitude,
          accuracy_meters: sample.accuracy_meters ?? null,
        });
      } catch {
        // Background GPS pings - never toast; honesty copy covers stale pin.
      }
    },
  );
  const needsMeetingPoint =
    !!ride &&
    ['confirmed', 'pickup_pending'].includes(ride.status) &&
    !ride.meeting_point_label;

  const meetingSuggestions = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{
      id: string;
      label: string;
      latitude: number;
      longitude: number;
      hint?: string;
      walkMeters?: number | null;
    }> = [];
    const push = (
      id: string,
      label: string,
      latitude: number,
      longitude: number,
      walkMeters?: number | null,
    ) => {
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      const key = `${latitude.toFixed(4)}:${longitude.toFixed(4)}:${label.toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        id,
        label,
        latitude,
        longitude,
        walkMeters: walkMeters ?? null,
        hint:
          walkMeters != null && Number.isFinite(walkMeters)
            ? `~${Math.round(walkMeters)} m walk`
            : undefined,
      });
    };
    for (const pt of rankedMeetups) {
      push(
        String(pt.id),
        pt.label,
        Number(pt.latitude),
        Number(pt.longitude),
        Number(pt.walk_meters) || null,
      );
    }
    for (const pt of meetupPoints) {
      push(String(pt.id), pt.label, Number(pt.latitude), Number(pt.longitude), null);
    }
    return out;
  }, [rankedMeetups, meetupPoints]);

  const smartMeet = useMemo(() => {
    if (!ride) return null;
    const guestPickup =
      ride.guest_pickup_latitude != null && ride.guest_pickup_longitude != null
        ? {
            lat: Number(ride.guest_pickup_latitude),
            lng: Number(ride.guest_pickup_longitude),
          }
        : null;
    const hostOrigin =
      ride.origin_latitude != null && ride.origin_longitude != null
        ? { lat: Number(ride.origin_latitude), lng: Number(ride.origin_longitude) }
        : null;
    const path = ride.route_polyline ? decodePolyline(String(ride.route_polyline)) : [];
    const sameSociety =
      !!ride.partner_society_id &&
      !!ride.society_id &&
      String(ride.partner_society_id) === String(ride.society_id);
    return suggestSmartMeetSpot({
      sameSociety,
      guestPickup,
      guestSocietyLabel: ride.partner_society || null,
      hostOrigin,
      hostPath: path,
      societyGates: meetingSuggestions.map((s) => ({
        id: s.id,
        label: s.label,
        lat: s.latitude,
        lng: s.longitude,
        walkMeters: s.walkMeters ?? null,
      })),
    });
  }, [ride, meetingSuggestions]);

  const siblingGuests = useMemo(() => {
    if (!ride?.publication_id) return [];
    return publicationRides.filter(
      (r) =>
        r.guest_dest_latitude != null &&
        r.guest_dest_longitude != null,
    );
  }, [publicationRides, ride?.publication_id]);

  // Load latest paid fuel payment for host payout controls when the ride is completed.
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

  // Map: published route polyline + live H/G + meeting pin (Uber/Hopr style live layer)
  useEffect(() => {
    if (!isLoaded || !mapEl || !window.google?.maps) return;
    const map = new google.maps.Map(mapEl, {
      center: locations[0]
        ? { lat: Number(locations[0].latitude), lng: Number(locations[0].longitude) }
        : ride?.meeting_point_latitude != null
          ? {
              lat: Number(ride.meeting_point_latitude),
              lng: Number(ride.meeting_point_longitude),
            }
          : { lat: 12.9716, lng: 77.5946 },
      zoom: 14,
      disableDefaultUI: true,
      zoomControl: true,
    });
    const markers: google.maps.Marker[] = [];
    let routeLine: google.maps.Polyline | null = null;
    let gapLine: google.maps.Polyline | null = null;
    let distLabel: google.maps.Marker | null = null;

    const paint = () => {
      markers.splice(0).forEach((m) => m.setMap(null));
      routeLine?.setMap(null);
      gapLine?.setMap(null);
      distLabel?.setMap(null);
      routeLine = null;
      gapLine = null;
      distLabel = null;

      const bounds = new google.maps.LatLngBounds();
      let any = false;

      const routePath =
        typeof ride?.route_polyline === 'string' && ride.route_polyline.length > 4
          ? decodePolyline(ride.route_polyline)
          : [];
      if (routePath.length >= 2) {
        routeLine = new google.maps.Polyline({
          map,
          path: routePath,
          geodesic: true,
          strokeColor: '#7BA88A',
          strokeOpacity: 0.9,
          strokeWeight: 5,
        });
        routePath.forEach((p) => bounds.extend(p));
        any = true;
        setMapDistanceLabel('Published road · live pins update as you move');
      }

      const meet =
        ride?.meeting_point_latitude != null && ride?.meeting_point_longitude != null
          ? {
              lat: Number(ride.meeting_point_latitude),
              lng: Number(ride.meeting_point_longitude),
            }
          : null;
      if (meet) {
        markers.push(
          new google.maps.Marker({
            map,
            position: meet,
            label: 'M',
            title: ride.meeting_point_label || 'Meeting pin',
          }),
        );
        bounds.extend(meet);
        any = true;
      }

      const hostLoc = locations.find((l) => l.role === 'host') || locations[0];
      const guestLoc = locations.find((l) => l.role === 'guest');
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
        any = true;
      });

      const a = hostLoc
        ? { lat: Number(hostLoc.latitude), lng: Number(hostLoc.longitude) }
        : meet;
      const b = guestLoc
        ? { lat: Number(guestLoc.latitude), lng: Number(guestLoc.longitude) }
        : meet && hostLoc
          ? meet
          : null;
      if (a && b && (a.lat !== b.lat || a.lng !== b.lng) && routePath.length < 2) {
        const meters = haversineMeters(a, b);
        const label = formatStraightLineDistance(meters);
        setMapDistanceLabel(label ? `About ${label} apart (straight line)` : null);
        gapLine = new google.maps.Polyline({
          map,
          path: [a, b],
          geodesic: true,
          strokeOpacity: 0,
          icons: [
            {
              icon: {
                path: 'M 0,-1 0,1',
                strokeOpacity: 1,
                strokeColor: '#A3C9A8',
                scale: 3,
              },
              offset: '0',
              repeat: '14px',
            },
          ],
        });
        if (label) {
          distLabel = new google.maps.Marker({
            map,
            position: { lat: (a.lat + b.lat) / 2, lng: (a.lng + b.lng) / 2 },
            clickable: false,
            icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
            label: {
              text: label,
              color: '#A3C9A8',
              fontSize: '11px',
              fontWeight: '700',
            },
          });
        }
      } else if (routePath.length < 2) {
        setMapDistanceLabel(null);
      }

      if (!any) return;
      if (markers.length > 1 || routePath.length > 1) {
        map.fitBounds(bounds, 48);
      } else {
        map.setCenter(bounds.getCenter());
      }
    };
    paint();
    return () => {
      markers.forEach((m) => m.setMap(null));
      routeLine?.setMap(null);
      gapLine?.setMap(null);
      distLabel?.setMap(null);
    };
  }, [
    isLoaded,
    mapEl,
    locations,
    ride?.meeting_point_latitude,
    ride?.meeting_point_longitude,
    ride?.meeting_point_label,
    ride?.route_polyline,
  ]);

  const pulseCelebrate = () => {
    setCelebrate(true);
    window.setTimeout(() => setCelebrate(false), 900);
  };

  useEffect(() => {
    if (!ride?.status) return;
    if (
      !['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'].includes(
        ride.status,
      )
    ) {
      return;
    }
    const t = window.setInterval(() => setClockTick((n) => n + 1), 15_000);
    return () => window.clearInterval(t);
  }, [ride?.status]);

  const pendingShare = useMemo(
    () => shares.find((s: any) => s.status === 'proposed' && s.proposer_user_id !== user?.id),
    [shares, user?.id],
  );

  const partnerLocation = useMemo(() => {
    if (!locations.length) return null;
    if (!user?.id) return locations[0];
    return locations.find((l) => l.user_id !== user.id) || locations[0];
  }, [locations, user?.id]);

  // clockTick keeps freshness labels honest while the ride is live
  void clockTick;
  const partnerFreshness = locationFreshnessLabel(partnerLocation?.recorded_at);
  const partnerTone = locationFreshnessTone(partnerLocation?.recorded_at);
  const shareTtlHours = Number(capabilities?.share_link_ttl_hours || 2);
  const sosSmsReady = capabilities?.sos_sms !== false;
  const fuelCheckoutReady = capabilities?.fuel_checkout !== false;

  useEffect(() => {
    if (!ride || !isLoaded) {
      setDropOrderState(null);
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
        label: g.id === ride.id && !isHost ? `You (${who})` : who,
        lat: Number(g.guest_dest_latitude),
        lng: Number(g.guest_dest_longitude),
      };
    });

    // Guest drops only - Extra matching pins are not passenger drop stops.
    if (guestStops.length < 1) {
      const cached = parseDropOrderJson((ride as { drop_order_json?: unknown }).drop_order_json);
      if (cached) setDropOrderState(cached);
      else {
        setDropOrderState(null);
        setDropNav(null);
      }
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
    const meetingOrPickup =
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
    const officePin =
      office != null
        ? { lat: Number(office.latitude), lng: Number(office.longitude) }
        : null;
    const direction = (ride as { direction?: string | null }).direction || 'to_office';
    const origin =
      direction === 'to_home'
        ? officePin || meetingOrPickup
        : meetingOrPickup || officePin;
    const destination =
      direction === 'to_home'
        ? meetingOrPickup || officePin
        : officePin ||
          (ride.guest_dest_latitude != null && ride.guest_dest_longitude != null
            ? {
                lat: Number(ride.guest_dest_latitude),
                lng: Number(ride.guest_dest_longitude),
              }
            : null);

    if (!origin || !destination) {
      setDropOrderState(null);
      setDropNav(null);
      return;
    }

    let cancelled = false;
    void planDropSequence({
      origin,
      destination,
      stops: guestStops,
    }).then(async (plan) => {
      if (cancelled) return;
      const cached = parseDropOrderJson(
        (ride as { drop_order_json?: unknown }).drop_order_json,
      );
      const local = dropOrderStateRef.current;
      // Local Arrived/Guest-off must win over a stale re-plan (ride.drop_order_json is often empty).
      const mergedProgress = preferDropProgress(cached?.progress, local?.progress);
      const payload = buildDropOrderPayload(plan, mergedProgress);
      setDropOrderState(payload);
      dropOrderStateRef.current = payload;
      setDropNav({
        origin,
        destination,
        waypoints: plan.ordered.map((s) => ({ lat: s.lat, lng: s.lng })),
      });
      const orderedKey = (o?: DropOrderPersisted | null) =>
        (o?.ordered || []).map((s) => s.id).join('|');
      const structureChanged = orderedKey(cached) !== orderedKey(payload);
      // Persist structure only - progress saves go through markDropStop so re-plans cannot wipe Arrived.
      if (isHost && ride.publication_id && plan.ordered.length >= 1 && structureChanged) {
        try {
          await setDropOrder.mutateAsync({
            publication_id: ride.publication_id,
            drop_order: payload,
          });
        } catch {
          // Best-effort persist
        }
      }
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
    (ride as { direction?: string | null } | null)?.direction,
    (ride as { drop_order_json?: unknown } | null)?.drop_order_json,
    siblingGuests,
    offices,
    isLoaded,
    setDropOrder,
  ]);

  const markDropStop = async (stopId: string, status: DropProgressStatus) => {
    if (!dropOrderState || !isHost) return;
    const next = withUpdatedStopProgress(dropOrderState, stopId, status);
    setDropOrderState(next);
    dropOrderStateRef.current = next;
    if (!ride?.publication_id) {
      toast.message(
        status === 'arrived' ? 'Arrived at drop' : 'Guest marked off',
      );
      return;
    }
    setMarkingStopId(stopId);
    try {
      await setDropOrder.mutateAsync({
        publication_id: ride.publication_id,
        drop_order: next,
      });
      toast.message(
        status === 'arrived' ? 'Arrived at drop' : 'Guest marked off',
      );
      if (status === 'arrived') {
        try {
          const pos = await getCurrentPosition();
          if (pos) setDropGps({ lat: pos.latitude, lng: pos.longitude });
        } catch {
          // optional GPS for next Maps open
        }
      }
    } catch {
      toast.error('Could not save drop progress');
      // Keep local Arrived/Guest-off so the button still advances; retry on next mark.
    } finally {
      setMarkingStopId(null);
    }
  };

  if (isLoading && !ride) {
    return (
      <CleanerCityChrome headerTitle="Ride" immersive>
        <CleanerCityGate>
          <p className="p-4 text-sm text-muted-foreground">Loading ride...</p>
        </CleanerCityGate>
      </CleanerCityChrome>
    );
  }

  if (!ride) {
    return (
      <CleanerCityChrome headerTitle="Ride" immersive>
        <CleanerCityGate>
          <div className="p-4 space-y-3">
            <p className="text-sm font-semibold">Could not open this ride</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Your request may still be on Find under Your rides. Open that card, or try again in a
              moment.
            </p>
            <Link to="/cleaner-city" className="text-primary text-sm font-semibold">
              Back to find
            </Link>
          </div>
        </CleanerCityGate>
      </CleanerCityChrome>
    );
  }

  const meetingPicker = (
    <CleanerCityMeetingPointPicker
      rideId={ride.id}
      isHost={!!isHost}
      currentLabel={ride.meeting_point_label}
      currentLat={ride.meeting_point_latitude}
      currentLng={ride.meeting_point_longitude}
      smartSuggest={smartMeet}
      guestPickupLat={ride.guest_pickup_latitude}
      guestPickupLng={ride.guest_pickup_longitude}
      guestPickupLabel={
        ride.partner_society ? `Near ${ride.partner_society}` : 'Guest on your road'
      }
      hostOriginLat={
        ride.origin_latitude ??
        offices.find((o) => o.is_primary)?.latitude ??
        offices[0]?.latitude ??
        null
      }
      hostOriginLng={
        ride.origin_longitude ??
        offices.find((o) => o.is_primary)?.longitude ??
        offices[0]?.longitude ??
        null
      }
      hostOriginLabel={ride.origin_label || 'Near your start'}
      savedSuggestions={meetingSuggestions}
      saving={setMeetingPoint.isPending}
      onSave={(input) => setMeetingPoint.mutateAsync(input)}
    />
  );

  const visibleTabs = useMemo((): RideWorkspaceTab[] => {
    const status = String(ride?.status || '');
    if (status === 'started') return ['trip', 'safety'];
    if (status === 'completed' || status === 'disputed') return ['trip', 'more'];
    if (['confirmed', 'pickup_pending', 'requested'].includes(status)) {
      return ['trip', 'chat', 'safety'];
    }
    return ['trip', 'chat', 'safety', 'more'];
  }, [ride?.status]);

  useEffect(() => {
    if (!visibleTabs.includes(rideTab)) {
      setRideTab(visibleTabs[0] || 'trip');
    }
  }, [visibleTabs, rideTab]);

  const openRideChat = () => {
    if (!visibleTabs.includes('chat')) {
      toast.message('Chat opens before the ride starts');
      return;
    }
    setRideTab('chat');
    window.setTimeout(() => {
      document
        .getElementById('cleaner-city-ride-chat')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const shareLivePin = async () => {
    if (!ride?.id || sharingLivePin) return;
    setSharingLivePin(true);
    try {
      const pos = await getCurrentPosition({ requestPermission: true });
      await upsertLoc.mutateAsync({
        ride_id: ride.id,
        latitude: pos.latitude,
        longitude: pos.longitude,
        accuracy_meters: pos.accuracy ?? null,
      });
      const mapsLink = `https://www.google.com/maps?q=${pos.latitude},${pos.longitude}`;
      if (ride.society_id) {
        await sendRideChat.mutateAsync({
          ride_id: ride.id,
          society_id: ride.society_id,
          body: `My live pin (open in Maps): ${mapsLink}`,
        });
      }
      await queryClient.invalidateQueries({
        queryKey: ['cleaner-city-ride-locations', ride.id],
      });
      toast.success('Live pin shared with partner');
    } catch (e: any) {
      toast.error(e?.message || 'Could not share location');
    } finally {
      setSharingLivePin(false);
    }
  };

  const callRidePartner = async () => {
    if (!ride?.id || heroCallBusy) return;
    setHeroCallBusy(true);
    try {
      const caps = await fetchVoipCapabilities();
      if (caps?.can_place_calls) {
        const ctx = resolveCleanerCityRideCall(ride.id);
        await startVoipCall({
          contextType: ctx.contextType,
          contextId: ride.id,
        });
        toast.success('Calling partner');
        return;
      }
      if (relayCallReady) {
        const res = await requestMaskedCall.mutateAsync(ride.id);
        if (res?.dispatch_error) {
          toast.message('Call saved - dial setup still finishing');
        } else {
          toast.success('Masked call started - answer on your phone');
        }
        return;
      }
      toast.message('Call not ready - opening chat');
      openRideChat();
    } catch (e: any) {
      toast.error(e?.message || 'Call failed - try chat');
      openRideChat();
    } finally {
      setHeroCallBusy(false);
    }
  };

  return (
    <CleanerCityChrome headerTitle="Active ride" immersive className="bg-[#F7F5F1]">
      <CleanerCityGate>
        <div
          className="relative mx-auto w-full max-w-lg space-y-4 px-4 pb-24 pt-3"
          data-testid="cleaner-city-ride-page"
        >
          {arrivalNotice &&
          !['started', 'completed', 'cancelled', 'no_show', 'disputed'].includes(ride.status) ? (
            <p className="relative rounded-xl border border-emerald-800/15 bg-emerald-50/80 px-3 py-2 text-[12px] font-medium text-emerald-950">
              {arrivalNotice}
            </p>
          ) : null}

          <RideMissionHero
            ride={ride}
            isHost={!!isHost}
            avgStars={rep?.avg_stars}
            ratingCount={rep?.rating_count}
            completedRides={rep?.completed_rides}
            celebrate={celebrate}
            onChat={visibleTabs.includes('chat') ? openRideChat : undefined}
            onCall={callRidePartner}
            callBusy={heroCallBusy || requestMaskedCall.isPending}
            callAvailable={
              ['requested', 'confirmed', 'pickup_pending', 'started'].includes(ride.status)
            }
          />

          {['requested', 'confirmed', 'pickup_pending', 'started', 'safety_incident'].includes(
            ride.status,
          ) ? (
            <RideQuickActions
              onCall={callRidePartner}
              onChat={visibleTabs.includes('chat') ? openRideChat : undefined}
              callBusy={heroCallBusy || requestMaskedCall.isPending}
              callAvailable={
                ['requested', 'confirmed', 'pickup_pending', 'started'].includes(ride.status)
              }
              shareBusy={shareToken.isPending}
              sosBusy={report.isPending}
              onShare={
                canShowTripShare(ride.status)
                  ? async () => {
                      try {
                        const row = await shareToken.mutateAsync(ride.id);
                        const url = `${window.location.origin}/cleaner-city/share/${row.token}`;
                        setShareUrl(url);
                        setShareExpiresAt(row.expires_at || '');
                        try {
                          await navigator.clipboard.writeText(url);
                          toast.success('Trip link copied');
                        } catch {
                          toast.success('Trip link ready');
                        }
                      } catch (e: any) {
                        toast.error(e?.message || 'Share failed');
                      }
                    }
                  : undefined
              }
              onSos={
                canShowRideSos(ride.status)
                  ? () => {
                      setSosConfirmOpen(true);
                      setRideTab('safety');
                    }
                  : undefined
              }
            />
          ) : null}

          <RidePrimaryActions
            ride={ride}
            isHost={!!isHost}
            needsMeetingPoint={!!needsMeetingPoint}
            otp={otp}
            shownOtp={shownOtp}
            onOtpChange={setOtp}
            accepting={respond.isPending}
            declining={respond.isPending}
            cancelling={cancelRide.isPending}
            generatingOtp={generateOtp.isPending}
            starting={startRide.isPending}
            completing={completeRide.isPending}
            onAccept={async () => {
              try {
                await respond.mutateAsync({ ride_id: ride.id, accept: true });
                pulseCelebrate();
                toast.success('Accepted');
                setRideTab('trip');
              } catch (e: any) {
                toast.error(e?.message || 'Could not accept');
              }
            }}
            onDecline={async () => {
              try {
                await respond.mutateAsync({ ride_id: ride.id, accept: false });
                toast.success('Declined');
              } catch (e: any) {
                toast.error(e?.message || 'Could not decline');
              }
            }}
            onCancel={async () => {
              try {
                await cancelRide.mutateAsync({ ride_id: ride.id });
                toast.success('Seat cancelled');
              } catch (e: any) {
                toast.error(e?.message || 'Could not cancel');
              }
            }}
            onGenerateOtp={async () => {
              try {
                const res = await generateOtp.mutateAsync(ride.id);
                setShownOtp(res.otp);
                pulseCelebrate();
                toast.success('Pickup code ready');
              } catch (e: any) {
                toast.error(e?.message || 'OTP failed');
              }
            }}
            onStart={async () => {
              if (needsMeetingPoint) {
                toast.error('Confirm meet spot first');
                setRideTab('trip');
                return;
              }
              try {
                await startRide.mutateAsync({ ride_id: ride.id, otp });
                pulseCelebrate();
                toast.success('Ride started');
                setRideTab('trip');
              } catch (e: any) {
                toast.error(e?.message || 'Invalid OTP');
              }
            }}
            onComplete={async () => {
              try {
                await completeRide.mutateAsync(ride.id);
                pulseCelebrate();
                toast.success('Ride complete');
                setRideTab('more');
                window.setTimeout(() => {
                  document
                    .getElementById('cleaner-city-rate-section')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 200);
              } catch (e: any) {
                toast.error(e?.message || 'Failed');
              }
            }}
            onScrollToMeeting={() => {
              setRideTab('trip');
              window.setTimeout(() => {
                document
                  .getElementById('cleaner-city-meeting-point-section')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 50);
            }}
            onScrollToChat={openRideChat}
            onScrollToRate={() => {
              setRideTab('more');
              window.setTimeout(() => {
                document
                  .getElementById('cleaner-city-rate-section')
                  ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }, 50);
            }}
            onOpenMaps={
              isHost && dropNav && !(dropOrderState && dropOrderState.ordered.length >= 1)
                ? () => openGoogleMapsDirections(dropNav)
                : null
            }
            awaitingDrops={
              !!isHost &&
              ride.status === 'started' &&
              !!dropOrderState &&
              dropOrderState.ordered.length >= 1
            }
            meetingPickerSlot={
              needsMeetingPoint && canCoordinate ? meetingPicker : null
            }
          />

          <RideWorkspaceTabs
            value={rideTab}
            onChange={setRideTab}
            visible={visibleTabs}
            badges={{
              trip: needsMeetingPoint || active,
              chat: (rideChat?.length || 0) > 0 || (quickMessages?.length || 0) > 0,
              safety: canShowRideSos(ride.status),
            }}
          />

          {rideTab === 'trip' ? (
            <div className="space-y-4" data-testid="cleaner-city-ride-tab-trip">
              {/* Pre-start only: meet tools. Once started, that phase is done. */}
              {['confirmed', 'pickup_pending'].includes(ride.status) ? (
                <>
                  {ride.meeting_point_label ? (
                    <p
                      className="px-1 text-xs font-semibold text-primary"
                      data-testid="cleaner-city-meeting-point-label"
                    >
                      Meet: {ride.meeting_point_label}
                    </p>
                  ) : null}

                  {canCoordinate && !needsMeetingPoint ? (
                    <div id="cleaner-city-meeting-point-section">{meetingPicker}</div>
                  ) : null}

                  <RideFindEachOther
                    sharing={sharingLivePin}
                    partnerPin={
                      partnerLocation
                        ? {
                            latitude: Number(partnerLocation.latitude),
                            longitude: Number(partnerLocation.longitude),
                            recorded_at: partnerLocation.recorded_at,
                          }
                        : null
                    }
                    onShareMine={shareLivePin}
                  />

                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={async () => {
                      try {
                        await markNoShow.mutateAsync({ ride_id: ride.id });
                        toast.success('Marked no-show');
                      } catch (e: any) {
                        toast.error(e?.message || 'Could not mark no-show');
                      }
                    }}
                    data-testid="cleaner-city-mark-no-show"
                  >
                    Mark no-show
                  </Button>
                </>
              ) : null}

              {/* En route: drops first. Meet UI stays off after start. */}
              {ride.status === 'started' &&
              dropOrderState &&
              dropOrderState.ordered.length >= 1 &&
              dropNav ? (
                <DropRunPanel
                  dropOrder={dropOrderState}
                  isHost={isHost}
                  myRideId={ride.id}
                  rideStatus={ride.status}
                  missionOrigin={dropNav.origin}
                  hostFinalDest={dropNav.destination}
                  currentGps={dropGps}
                  onMarkStop={markDropStop}
                  markingStopId={markingStopId}
                  completing={completeRide.isPending}
                  onCompleteRide={async () => {
                    try {
                      await completeRide.mutateAsync(ride.id);
                      pulseCelebrate();
                      toast.success('Ride complete');
                      setRideTab('more');
                      window.setTimeout(() => {
                        document
                          .getElementById('cleaner-city-rate-section')
                          ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 200);
                    } catch (e: any) {
                      toast.error(e?.message || 'Failed');
                    }
                  }}
                />
              ) : null}

              {/* No embedded live map - opens external Maps only (avoids Maps JS billing). */}
              <span className="sr-only" data-testid="cleaner-city-live-tracking">
                Live map off
              </span>
              <span className="sr-only" data-testid="cleaner-city-ride-map" />
              <span className="sr-only" data-testid="cleaner-city-map-distance">
                {mapDistanceLabel || ''}
              </span>
              <span className="sr-only" data-testid="cleaner-city-location-freshness">
                Partner: {partnerFreshness}
              </span>
              <span className="sr-only" data-testid="cleaner-city-background-location-note">
                {trackingStatus.honestyCopy}
              </span>

              {ride.status === 'started' &&
              !(dropOrderState && dropOrderState.ordered.length >= 1 && dropNav) ? (
                <p className="rounded-2xl border border-border bg-card px-4 py-5 text-center text-sm text-muted-foreground">
                  On the way. Use Complete when guests are dropped.
                </p>
              ) : null}
            </div>
          ) : null}

          {rideTab === 'chat' ? (
            <div className="space-y-4" data-testid="cleaner-city-ride-tab-chat">
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

          {['requested', 'confirmed', 'pickup_pending', 'started', 'completed'].includes(
            ride.status,
          ) ? (
            <RideChatStrip
              rideId={ride.id}
              messages={rideChat}
              myUserId={user?.id}
              partnerName={ride.partner_name}
              partnerAvatarUrl={ride.partner_avatar_url}
              body={chatBody}
              onBodyChange={setChatBody}
              sending={sendRideChat.isPending}
              disabled={!ride.society_id}
              onSend={async () => {
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
            />
          ) : null}

          {['confirmed', 'pickup_pending', 'started'].includes(ride.status) ? (
            <div className="space-y-2" data-testid="cleaner-city-call-panel">
              {voipCallReady ? (
                <CallButton
                  contextType={resolveCleanerCityRideCall(ride.id).contextType}
                  contextId={ride.id}
                  onFallback={() => {
                    toast.message('Voice call not ready - use chat');
                  }}
                />
              ) : relayCallReady ? (
                <Button
                  className="w-full h-12 font-semibold"
                  variant="outline"
                  disabled={requestMaskedCall.isPending}
                  data-testid="cleaner-city-relay-call"
                  onClick={async () => {
                    try {
                      const res = await requestMaskedCall.mutateAsync(ride.id);
                      if (res?.dispatch_error) {
                        toast.message('Call saved - dial setup still finishing');
                      } else {
                        toast.success('Masked call started - answer on your phone');
                      }
                    } catch (e: any) {
                      toast.error(e?.message || 'Call failed - use chat');
                    }
                  }}
                >
                  {requestMaskedCall.isPending ? 'Connecting...' : 'Call (masked)'}
                </Button>
              ) : (
                <Button
                  className="w-full h-12 font-semibold"
                  variant="outline"
                  onClick={() =>
                    document
                      .getElementById('cleaner-city-ride-chat')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  data-testid="cleaner-city-message-instead-of-call"
                >
                  Message partner
                </Button>
              )}
              <p
                className="px-1 text-[11px] text-muted-foreground"
                data-testid="cleaner-city-call-honesty"
              >
                {voipCallReady
                  ? 'In-app voice call.'
                  : relayCallReady
                    ? 'Numbers stay private - both phones ring via relay.'
                    : 'Voice call not set up - chat your partner instead.'}
              </p>
            </div>
          ) : null}
            </div>
          ) : null}

          {rideTab === 'safety' ? (
            <div className="space-y-4" data-testid="cleaner-city-ride-tab-safety">
          {(canShowRideSos(ride.status) || canShowTripShare(ride.status)) ? (
            <div
              className="space-y-3 rounded-2xl border border-border bg-card p-4"
              data-testid="cleaner-city-safety-tools"
            >
              <div>
                <p className="text-sm font-semibold">Safety</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  SOS and trip share while this seat is live.
                </p>
              </div>
              {sosConfirmOpen ? (
                <div
                  className="space-y-2 rounded-xl border border-destructive/40 bg-destructive/10 p-3"
                  data-testid="cleaner-city-sos-confirm"
                >
                  <p className="text-sm font-semibold">Send SOS to contacts?</p>
                  <p className="text-[11px] text-muted-foreground">
                    Alerts partner, linked contacts, and society admins. This is not a 112 dialer.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="destructive"
                      className="h-11 font-semibold"
                      data-testid="cleaner-city-sos-confirm-yes"
                      onClick={async () => {
                        setSosConfirmOpen(false);
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
                          let smsOk = true;
                          let smsDetail = '';
                          try {
                            const dispatched: any = await dispatchSafety.mutateAsync(
                              result?.alert_id || null,
                            );
                            if (
                              dispatched?.failed ||
                              dispatched?.error ||
                              dispatched?.sms_failed ||
                              (Array.isArray(dispatched?.errors) && dispatched.errors.length)
                            ) {
                              smsOk = false;
                              smsDetail =
                                dispatched?.error ||
                                dispatched?.message ||
                                'SMS / call relay not configured';
                            }
                          } catch (dispatchErr: any) {
                            smsOk = false;
                            smsDetail =
                              dispatchErr?.message || 'SMS dispatcher unavailable';
                          }
                          const contacts = Number(result?.notified_contacts || 0);
                          const admins = Number(result?.notified_admins || 0);
                          const skipped = Number(result?.phone_only_contacts_skipped || 0);
                          const counterpart = result?.notified_counterpart ? 1 : 0;
                          setSosResult({ contacts, admins, counterpart, skipped });
                          try {
                            const row = await shareToken.mutateAsync(ride.id);
                            const url = `${window.location.origin}/cleaner-city/share/${row.token}`;
                            setShareUrl(url);
                            setShareExpiresAt(row.expires_at || '');
                          } catch {
                            /* share optional after SOS */
                          }
                          if (contacts + admins + counterpart === 0) {
                            toast.message('SOS saved in app', {
                              description:
                                'Nobody reachable in-app yet. Call 112 if in danger.' +
                                (!smsOk ? ` SMS: ${smsDetail}` : ''),
                            });
                          } else {
                            toast.success(
                              `Alerted partner ${counterpart}, contacts ${contacts}, admins ${admins}` +
                                (skipped > 0 ? ` · ${skipped} phone-only need SMS setup` : '') +
                                (!smsOk ? ` · SMS not sent (${smsDetail})` : ''),
                            );
                          }
                        } catch (e: any) {
                          toast.error(e?.message || 'SOS failed');
                        }
                      }}
                    >
                      Send SOS
                    </Button>
                    <Button
                      variant="outline"
                      className="h-11 font-semibold"
                      onClick={() => setSosConfirmOpen(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {canShowRideSos(ride.status) ? (
                    <Button
                      variant="destructive"
                      className="h-12 font-semibold"
                      onClick={() => setSosConfirmOpen(true)}
                      data-testid="cleaner-city-sos"
                    >
                      SOS
                    </Button>
                  ) : (
                    <div />
                  )}
                  {canShowTripShare(ride.status) ? (
                    <Button
                      variant="outline"
                      className="h-12 font-semibold"
                      onClick={async () => {
                        try {
                          const row = await shareToken.mutateAsync(ride.id);
                          const url = `${window.location.origin}/cleaner-city/share/${row.token}`;
                          setShareUrl(url);
                          setShareExpiresAt(row.expires_at || '');
                          await navigator.clipboard?.writeText(url);
                          toast.success(`Trip link copied - expires in ~${shareTtlHours}h`);
                        } catch (e: any) {
                          toast.error(e?.message || 'Share failed');
                        }
                      }}
                      data-testid="cleaner-city-trip-share"
                    >
                      Trip share
                    </Button>
                  ) : null}
                </div>
              )}
              {shareUrl ? (
                <div
                  className="space-y-2 rounded-xl border border-border bg-muted/40 p-3"
                  data-testid="cleaner-city-share-active"
                >
                  <p className="break-all text-[11px] text-muted-foreground">{shareUrl}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {shareExpiresAt
                      ? `Expires ${formatCountdown(shareExpiresAt) || String(shareExpiresAt).slice(0, 19)}.`
                      : `Expires in ~${shareTtlHours}h. Revoke anytime.`}
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-9 font-semibold"
                    disabled={revokeShare.isPending}
                    onClick={async () => {
                      try {
                        await revokeShare.mutateAsync(ride.id);
                        setShareUrl('');
                        setShareExpiresAt('');
                        toast.success('Trip share revoked');
                      } catch (e: any) {
                        toast.error(e?.message || 'Could not revoke');
                      }
                    }}
                    data-testid="cleaner-city-trip-share-revoke"
                  >
                    Revoke link
                  </Button>
                </div>
              ) : null}
              {sosResult ? (
                <div
                  className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3"
                  data-testid="cleaner-city-sos-result"
                >
                  <p className="text-sm font-semibold">SOS sent</p>
                  <ul className="list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
                    <li>Partner: {sosResult.counterpart ? 'notified' : 'none'}</li>
                    <li>Contacts: {sosResult.contacts}</li>
                    <li>Admins: {sosResult.admins}</li>
                    {sosResult.skipped > 0 ? (
                      <li>{sosResult.skipped} phone-only need SMS setup</li>
                    ) : null}
                  </ul>
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <Button asChild variant="destructive" className="h-10 font-semibold">
                      <a href="tel:112">Call 112</a>
                    </Button>
                    <Button asChild variant="outline" className="h-10 font-semibold">
                      <Link to="/cleaner-city/safety">Contacts</Link>
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground" data-testid="cleaner-city-sos-explainer">
                  SOS alerts partner, contacts, and admins in-app.
                  {sosSmsReady ? '' : ' Phone SMS is not configured yet.'} For danger, call 112.{' '}
                  <Link to="/cleaner-city/safety" className="font-semibold text-primary">
                    Manage contacts
                  </Link>
                </p>
              )}
            </div>
          ) : (
            <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              Safety tools unlock once the seat is confirmed.
            </p>
          )}
            </div>
          ) : null}

          {rideTab === 'more' ? (
            <div className="space-y-4" data-testid="cleaner-city-ride-tab-more">
          {/* Activity log kept off the product surface - not useful mid-ride. */}
          <span className="sr-only" data-testid="cleaner-city-ride-timeline">
            Chat stays private
          </span>

          {canOpenDispute(ride.status) && !disputeCase ? (
            <div
              className="space-y-3 rounded-2xl border border-border bg-card p-4"
              data-testid="cleaner-city-dispute"
            >
              <div>
                <p className="text-sm font-semibold">Report a problem</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  After the ride ends. Partner and society admins are notified.
                </p>
              </div>
              <Input
                value={disputeNote}
                onChange={(e) => setDisputeNote(e.target.value)}
                placeholder="What happened?"
                data-testid="cleaner-city-dispute-note"
              />
              <Button
                variant="outline"
                className="h-11 w-full font-semibold"
                disabled={disputeRide.isPending || disputeNote.trim().length < 4}
                onClick={async () => {
                  try {
                    await disputeRide.mutateAsync({
                      ride_id: ride.id,
                      note: disputeNote.trim(),
                    });
                    toast.success('Problem reported');
                    setDisputeNote('');
                  } catch (e: any) {
                    toast.error(e?.message || 'Could not report');
                  }
                }}
              >
                Submit report
              </Button>
            </div>
          ) : null}

          {ride.status === 'disputed' ? (
            <div
              className="space-y-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4"
              data-testid="cleaner-city-dispute-appeal"
            >
              <div>
                <p className="text-sm font-semibold">Under review</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {disputeCase?.opened_by === user?.id
                    ? 'You reported this. Admin will decide.'
                    : 'Partner reported a problem. Add your side below.'}
                </p>
                {disputeCase?.note ? (
                  <p className="mt-2 rounded-xl border border-border bg-card px-3 py-2 text-xs">
                    Report: {disputeCase.note}
                  </p>
                ) : null}
              </div>
              {disputeCase?.status === 'appealed' || disputeCase?.appeal_note ? (
                <p className="text-xs text-muted-foreground">
                  Both sides in. Waiting on admin.
                  {disputeCase.appeal_note ? ` Reply: ${disputeCase.appeal_note}` : ''}
                </p>
              ) : disputeCase?.opened_by && disputeCase.opened_by !== user?.id ? (
                <>
                  <Input
                    value={appealNote}
                    onChange={(e) => setAppealNote(e.target.value)}
                    placeholder="Your side"
                    data-testid="cleaner-city-appeal-note"
                  />
                  <Button
                    variant="outline"
                    className="h-11 w-full font-semibold"
                    disabled={appealDispute.isPending || appealNote.trim().length < 4}
                    onClick={async () => {
                      try {
                        await appealDispute.mutateAsync({
                          ride_id: ride.id,
                          note: appealNote.trim(),
                        });
                        toast.success('Your side sent');
                        setAppealNote('');
                      } catch (e: any) {
                        toast.error(e?.message || 'Could not send');
                      }
                    }}
                  >
                    Tell my side
                  </Button>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Under review.</p>
              )}
            </div>
          ) : null}

          {ride.status === 'completed' ? (
            <div
              id="cleaner-city-rate-section"
              className="space-y-3 rounded-2xl border border-border bg-card p-4"
              data-testid="cleaner-city-rate-section"
            >
              <p className="text-sm font-semibold">Rate and fuel</p>
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

              <div className="pt-2 border-t border-border space-y-2" data-testid="cleaner-city-fuel-auto">
                <Label>Fuel contribution</Label>
                {(() => {
                  const snap = ride.fuel_snapshot || {};
                  const guestPaise =
                    Number(snap.guest_share_paise) ||
                    ride.estimated_fuel_paise ||
                    0;
                  const hostPaise =
                    Number(snap.host_share_paise) ||
                    ride.fuel_host_share_paise ||
                    0;
                  const totalPaise =
                    Number(snap.total_fuel_paise) ||
                    ride.fuel_total_paise ||
                    guestPaise + hostPaise;
                  const petrol =
                    Number(snap.petrol_paise_per_litre) ||
                    ride.fuel_petrol_paise_per_litre ||
                    12000;
                  const distM =
                    Number(snap.distance_meters) ||
                    ride.fuel_distance_meters ||
                    0;
                  if (!guestPaise) {
                    return (
                      <p className="text-[11px] text-muted-foreground" data-testid="cleaner-city-fuel-empty">
                        Fuel share shows after seat confirm (distance x petrol).
                      </p>
                    );
                  }
                  return (
                    <div className="space-y-1 rounded-xl border border-border bg-muted/20 px-3 py-2.5 text-sm">
                      <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                        Guest share: ₹{Math.max(1, Math.round(guestPaise / 100))}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Host ₹{Math.max(0, Math.round(hostPaise / 100))} · total ₹
                        {Math.max(1, Math.round(totalPaise / 100))}
                        {distM > 0 ? ` · ${(distM / 1000).toFixed(1)} km` : ''}
                        {` · ₹${(petrol / 100).toFixed(0)}/L`}
                      </p>
                    </div>
                  );
                })()}
                <p className="text-[11px] text-muted-foreground">
                  Guest pays via Razorpay. Host share stays payable until transfer. Amounts cannot be edited.
                  {capabilities && !fuelCheckoutReady
                    ? ' Online fuel checkout is not configured yet.'
                    : ''}
                </p>
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
                            toast.success('Fuel contribution paid.');
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
                  <div className="space-y-2 rounded-xl border border-border p-3" data-testid="cleaner-city-fuel-payout">
                    <p className="text-sm font-semibold">Send fuel to bank</p>
                    <p className="text-xs text-muted-foreground">
                      Link a Razorpay route account, then transfer after the guest pays.
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

              {otherUserId ? (
                <div className="space-y-1">
                  <Button
                    variant="ghost"
                    className="text-destructive"
                    onClick={async () => {
                      try {
                        await blockUser.mutateAsync({ blocked_user_id: otherUserId });
                        toast.success('Partner blocked from future matches');
                      } catch (e: any) {
                        toast.error(e?.message || 'Block failed');
                      }
                    }}
                  >
                    Block this partner
                  </Button>
                  <p className="text-[11px] text-muted-foreground">
                    Unblock anytime in{' '}
                    <Link to="/cleaner-city/safety" className="font-semibold underline">
                      Safety
                    </Link>
                    .
                  </p>
                </div>
              ) : null}
            </div>
          ) : null}

          {!(canOpenDispute(ride.status) && !disputeCase) &&
          ride.status !== 'disputed' &&
          ride.status !== 'completed' ? (
            <p className="rounded-2xl border border-border bg-card px-4 py-6 text-center text-sm text-muted-foreground">
              Rate, fuel, and problem reports show here after the ride.
            </p>
          ) : null}
            </div>
          ) : null}
        </div>
      </CleanerCityGate>
    </CleanerCityChrome>
  );
}
