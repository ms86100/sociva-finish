// @ts-nocheck
import { useBackgroundLocationTracking } from '@/hooks/useBackgroundLocationTracking';
import { Navigation, Loader2, AlertTriangle, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { useSystemSettingsRaw } from '@/hooks/useSystemSettingsRaw';
import { getTerminalStatuses } from '@/services/statusFlowCache';
import { supabase } from '@/integrations/supabase/client';

interface SellerGPSTrackerProps {
  assignmentId?: string | null;
  orderId?: string;
  autoStart?: boolean;
  deliveryStatus?: string;
}

export function SellerGPSTracker({ assignmentId, orderId, autoStart = true, deliveryStatus }: SellerGPSTrackerProps) {
  const [resolvedAssignmentId, setResolvedAssignmentId] = useState<string | null>(assignmentId || null);

  // Resolve assignmentId from orderId if not directly provided
  useEffect(() => {
    if (assignmentId) { setResolvedAssignmentId(assignmentId); return; }
    if (!orderId) return;

    const fetchAssignment = () => {
      supabase.from('delivery_assignments').select('id').eq('order_id', orderId).maybeSingle()
        .then(({ data }) => { if (data) setResolvedAssignmentId(data.id); });
    };
    fetchAssignment();

    // Subscribe for when trigger creates it
    const channel = supabase
      .channel(`gps-assignment-${orderId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'delivery_assignments', filter: `order_id=eq.${orderId}` },
        (payload) => { const id = (payload.new as any)?.id; if (id) setResolvedAssignmentId(id); })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [assignmentId, orderId]);

  const effectiveAssignmentId = resolvedAssignmentId || '';
  const {
    isTracking, permissionDenied, permissionLevel, lastSentAt,
    trackingPaused, startTracking, stopTracking,
  } = useBackgroundLocationTracking(effectiveAssignmentId);
  const [now, setNow] = useState(Date.now());
  const wakeLockRef = useRef<any>(null);
  const isNative = Capacitor.isNativePlatform();
  const [terminalSet, setTerminalSet] = useState<Set<string>>(new Set(['delivered', 'completed', 'cancelled', 'failed']));

  const { getSetting } = useSystemSettingsRaw([
    'ui_gps_broadcasting_title', 'ui_gps_keep_open_warning',
    'ui_gps_permission_denied', 'ui_start_sharing_location',
    'ui_sharing_location', 'ui_stop_sharing',
  ]);

  const gpsBroadcastingTitle = getSetting('ui_gps_broadcasting_title') || 'GPS Broadcasting';
  const keepOpenWarning = getSetting('ui_gps_keep_open_warning') || 'Keep this screen open while delivering. Browser backgrounding can pause GPS updates.';
  const permDeniedMsg = getSetting('ui_gps_permission_denied') || 'Location permission denied. Enable it in device settings to share your location with the buyer.';
  const startSharingLabel = getSetting('ui_start_sharing_location') || 'Start Sharing Location';
  const sharingLabel = getSetting('ui_sharing_location') || 'Sharing your location with buyer';
  const stopSharingLabel = getSetting('ui_stop_sharing') || 'Stop Sharing';

  useEffect(() => {
    getTerminalStatuses().then(s => setTerminalSet(s)).catch(() => {});
  }, []);

  const isTerminal = terminalSet.has(deliveryStatus || '');

  // Delay auto-start by 500ms to ensure the native bridge is fully initialized on cold start
  useEffect(() => {
    if (!autoStart || !effectiveAssignmentId || isTracking || permissionDenied || isTerminal) return;
    const timer = setTimeout(() => {
      startTracking();
    }, isNative ? 500 : 0);
    return () => clearTimeout(timer);
  }, [autoStart, effectiveAssignmentId, isTerminal, isTracking, isNative, permissionDenied, startTracking]);

  useEffect(() => {
    if (isTerminal && isTracking) {
      stopTracking();
    }
  }, [isTerminal, isTracking, stopTracking]);

  useEffect(() => {
    if (!isTracking) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [isTracking]);

  // Web-only wake lock (native doesn't need it with background geolocation plugin)
  useEffect(() => {
    if (isNative || !isTracking || !('wakeLock' in navigator)) return;

    const requestWakeLock = async () => {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      } catch { /* ignore */ }
    };

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && isTracking) requestWakeLock();
    };

    requestWakeLock();
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      wakeLockRef.current?.release?.().catch?.(() => {});
      wakeLockRef.current = null;
    };
  }, [isNative, isTracking]);

  const openNativeSettings = async () => {
    try {
      const { NativeSettings, IOSSettings, AndroidSettings } = await import('capacitor-native-settings');
      if (Capacitor.getPlatform() === 'ios') {
        await NativeSettings.open({ optionIOS: IOSSettings.App, optionAndroid: AndroidSettings.ApplicationDetails });
      } else {
        await NativeSettings.open({ optionIOS: IOSSettings.App, optionAndroid: AndroidSettings.ApplicationDetails });
      }
    } catch {
      // Plugin not available
    }
  };

  const lastSentText = lastSentAt ? `Updated ${Math.round((now - lastSentAt) / 1000)}s ago` : null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Navigation size={16} className="text-primary" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{gpsBroadcastingTitle}</p>
        </div>
        {isTracking && !trackingPaused && (
          <Badge variant="secondary" className="bg-primary/10 text-primary gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Live
          </Badge>
        )}
        {isTracking && trackingPaused && (
          <Badge variant="secondary" className="bg-destructive/10 text-destructive gap-1">
            <AlertTriangle size={10} />
            Paused
          </Badge>
        )}
      </div>

      {/* Web-only keep-open warning (native handles background natively) */}
      {!isNative && (
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-2.5">
          <p className="text-xs text-foreground">{keepOpenWarning}</p>
        </div>
      )}

      {/* Tracking paused alert (native only — watchdog detected stale) */}
      {isNative && trackingPaused && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 space-y-2">
          <p className="text-xs text-destructive font-medium">Location updates paused</p>
          <p className="text-xs text-muted-foreground">Keep the app open to resume tracking. The system will attempt to restart automatically.</p>
        </div>
      )}

      {/* Permission upgrade banner (native: WhenInUse → Always) */}
      {isNative && isTracking && permissionLevel === 'when_in_use' && (
        <div className="bg-warning/10 border border-warning/20 rounded-lg p-2.5 space-y-2">
          <p className="text-xs text-foreground">For uninterrupted delivery tracking, enable "Always" location access.</p>
          <Button variant="outline" size="sm" onClick={openNativeSettings} className="h-7 text-xs gap-1.5">
            <Settings size={12} />
            Open Settings
          </Button>
        </div>
      )}

      {permissionDenied && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2.5 space-y-2">
          <p className="text-xs text-destructive">{permDeniedMsg}</p>
          {isNative && (
            <Button variant="outline" size="sm" onClick={openNativeSettings} className="h-7 text-xs gap-1.5">
              <Settings size={12} />
              Open Settings
            </Button>
          )}
        </div>
      )}

      {!isTracking ? (
        <Button onClick={startTracking} disabled={permissionDenied || isTerminal} className="w-full bg-primary text-primary-foreground h-10 gap-2">
          <Navigation size={14} />
          {startSharingLabel}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
            <div className="flex items-center justify-center gap-2 text-sm font-medium text-primary">
              <Loader2 size={14} className="animate-spin" />
              {sharingLabel}
            </div>
            {lastSentText && <p className="text-[10px] text-muted-foreground mt-1">{lastSentText}</p>}
          </div>
          <Button variant="outline" onClick={stopTracking} className="w-full h-9 text-xs">
            {stopSharingLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
