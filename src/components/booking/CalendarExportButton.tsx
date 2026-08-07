import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { addToCalendar, parseBookingDateTime, type AddToCalendarResult } from '@/lib/calendar';
import { toast } from 'sonner';
import { Capacitor } from '@capacitor/core';

interface CalendarExportButtonProps {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
  className?: string;
  size?: 'sm' | 'default';
}

function showCalendarResult(result: AddToCalendarResult) {
  switch (result.status) {
    case 'added':
      toast.success('Added to your calendar');
      break;
    case 'downloaded': {
      const mobile =
        typeof navigator !== 'undefined' &&
        /iPhone|iPad|iPod|Android|gonative|median/i.test(navigator.userAgent);
      toast.success(
        mobile
          ? 'Open the calendar prompt to save your booking'
          : 'Calendar file downloaded — open it to save the event',
      );
      break;
    }
    case 'cancelled':
      // User dismissed the system editor — no error toast
      break;
    case 'denied':
      toast.error(result.message || 'Calendar permission denied', {
        action: Capacitor.isNativePlatform()
          ? {
              label: 'Settings',
              onClick: () => {
                void openAppSettings();
              },
            }
          : undefined,
      });
      break;
    case 'error':
      toast.error(result.message || 'Could not add to calendar');
      break;
  }
}

async function openAppSettings() {
  try {
    const { NativeSettings, AndroidSettings, IOSSettings } = await import('capacitor-native-settings');
    await NativeSettings.open({
      optionIOS: IOSSettings.App,
      optionAndroid: AndroidSettings.ApplicationDetails,
    });
  } catch (e) {
    console.warn('[Calendar] Could not open settings:', e);
  }
}

export function CalendarExportButton(props: CalendarExportButtonProps) {
  const [busy, setBusy] = useState(false);

  const handleExport = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const start = parseBookingDateTime(props.date, props.startTime);
      const end = parseBookingDateTime(props.date, props.endTime);
      const result = await addToCalendar({
        title: props.title,
        startDate: start,
        endDate: end,
        location: props.location,
        description: props.description,
      });
      showCalendarResult(result);
    } catch (e) {
      console.warn('[Calendar] Export failed:', e);
      toast.error('Could not add to calendar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      size={props.size === 'default' ? 'default' : 'sm'}
      className={props.className ?? 'gap-1.5 text-xs h-7'}
      onClick={handleExport}
      disabled={busy}
    >
      {busy ? <Loader2 size={12} className="animate-spin" /> : <CalendarPlus size={12} />}
      Add to Calendar
    </Button>
  );
}
