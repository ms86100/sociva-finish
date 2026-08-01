// @ts-nocheck
import { Capacitor } from '@capacitor/core';

interface CalendarEventData {
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  description?: string;
}

/**
 * On native (iOS/Android), opens the system calendar prompt.
 * On mobile web, opens a data-URI .ics (works on iOS Safari + Android Chrome).
 * On desktop web, downloads an .ics file.
 */
export async function addToCalendar(data: CalendarEventData): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await addToNativeCalendar(data);
  } else {
    openICS(data);
  }
}

async function addToNativeCalendar(data: CalendarEventData): Promise<void> {
  try {
    const { CapacitorCalendar } = await import('@ebarooni/capacitor-calendar');

    // Request write permission first
    const permResult = await CapacitorCalendar.requestWriteOnlyCalendarAccess();
    
    // Check if permission was granted
    if (permResult?.result === 'denied') {
      console.warn('Calendar permission denied, falling back to ICS');
      openICS(data);
      return;
    }

    await CapacitorCalendar.createEventWithPrompt({
      title: data.title,
      startDate: data.startDate.getTime(),
      endDate: data.endDate.getTime(),
      location: data.location,
      description: data.description,
    });
  } catch (error) {
    console.warn('Native calendar failed, falling back to ICS:', error);
    openICS(data);
  }
}

function formatICSDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function buildICSContent(data: CalendarEventData): string {
  const now = formatICSDate(new Date());
  const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@lovable.app`;

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Lovable//ServiceBooking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${formatICSDate(data.startDate)}`,
    `DTEND:${formatICSDate(data.endDate)}`,
    `DTSTAMP:${now}`,
    `SUMMARY:${escapeICS(data.title)}`,
    data.location ? `LOCATION:${escapeICS(data.location)}` : '',
    data.description ? `DESCRIPTION:${escapeICS(data.description)}` : '',
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n');
}

function escapeICS(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

/**
 * Opens an ICS file. On mobile browsers (iOS Safari, Android Chrome),
 * using window.open with a data URI or blob URL triggers the native
 * calendar app to handle the .ics file.
 */
function openICS(data: CalendarEventData): void {
  const content = buildICSContent(data);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  // On iOS Safari, we need to use window.open for .ics to trigger calendar
  const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  
  if (isMobile) {
    // Use a temporary link with target to open in same context
    // iOS Safari handles .ics blob URLs by opening the Calendar app
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'appointment.ics');
    // For iOS, setting the type helps Safari recognize the file
    link.type = 'text/calendar';
    document.body.appendChild(link);
    link.click();
    
    // Cleanup after a delay to ensure the download starts
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 1000);
  } else {
    // Desktop: standard download
    const a = document.createElement('a');
    a.href = url;
    a.download = 'appointment.ics';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
}
