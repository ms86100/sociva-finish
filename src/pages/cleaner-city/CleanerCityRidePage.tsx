// @ts-nocheck
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
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
  useProposeCostShare,
  useReportIncident,
  useReputation,
  useRideCostShares,
  useRideLocations,
  useStartRide,
  useSubmitRating,
  useUpsertRideLocation,
} from '@/hooks/queries/useCleanerCity';
import { useAuth } from '@/contexts/AuthContext';
import { getCurrentPosition } from '@/lib/native-location';
import { useGoogleMaps } from '@/hooks/useGoogleMaps';

export default function CleanerCityRidePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const { data: ride, isLoading } = useCleanerCityRide(id);
  const { data: locations = [] } = useRideLocations(
    ride && ['pickup_pending', 'started'].includes(ride.status) ? id : null,
  );
  const { data: shares = [] } = useRideCostShares(id);
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
  const [shareUrl, setShareUrl] = useState('');
  const [mapEl, setMapEl] = useState<HTMLDivElement | null>(null);

  const isHost = ride?.host_user_id === user?.id;
  const active = ride && ['pickup_pending', 'started'].includes(ride.status);

  // Live location publisher
  useEffect(() => {
    if (!active || !id) return;
    let cancelled = false;
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
    return () => {
      cancelled = true;
      clearInterval(t);
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
              {ride.travel_date} · {ride.status}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {isHost ? 'You are host' : 'You are guest'}
              {rep?.avg_stars != null
                ? ` · partner ${rep.avg_stars}★ (${rep.rating_count})`
                : ''}
            </p>
          </div>

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
              )}
            </div>
          )}
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
