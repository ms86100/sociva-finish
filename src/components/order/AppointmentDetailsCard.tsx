import { format } from 'date-fns';
import { Calendar, Clock, MapPin } from 'lucide-react';
import { useFlowStepLabels } from '@/hooks/useFlowStepLabels';
import { CalendarExportButton } from '@/components/booking/CalendarExportButton';

interface AppointmentDetailsCardProps {
  booking: {
    booking_date: string;
    start_time: string;
    end_time: string;
    location_type: string;
    status: string;
    buyer_address?: string | null;
    notes?: string | null;
  };
  /** Service / product name for the calendar event title */
  title?: string;
  sellerName?: string;
  /** Extra notes (e.g. order notes) for the calendar description */
  notes?: string | null;
}

const LOCATION_LABELS: Record<string, string> = {
  home_visit: 'At Home',
  at_buyer: 'At Home',
  at_seller: 'At Seller',
  online: 'Online',
};

function buildLocation(booking: AppointmentDetailsCardProps['booking']): string {
  const label = LOCATION_LABELS[booking.location_type] || booking.location_type;
  if (
    (booking.location_type === 'home_visit' || booking.location_type === 'at_buyer') &&
    booking.buyer_address?.trim()
  ) {
    return `${label}: ${booking.buyer_address.trim()}`;
  }
  return label;
}

function buildDescription(opts: {
  title: string;
  sellerName?: string;
  booking: AppointmentDetailsCardProps['booking'];
  notes?: string | null;
}): string {
  const lines: string[] = [`Sociva booking: ${opts.title}`];
  if (opts.sellerName) lines.push(`Seller: ${opts.sellerName}`);
  lines.push(`Location type: ${LOCATION_LABELS[opts.booking.location_type] || opts.booking.location_type}`);
  const note = (opts.notes || opts.booking.notes || '').trim();
  if (note) lines.push(`Notes: ${note}`);
  lines.push('Managed in the Sociva app');
  return lines.join('\n');
}

export function AppointmentDetailsCard({
  booking,
  title = 'Service appointment',
  sellerName,
  notes,
}: AppointmentDetailsCardProps) {
  const { getFlowLabel } = useFlowStepLabels();
  const bookingDate = new Date(booking.booking_date + 'T00:00:00');
  const statusConfig = getFlowLabel(booking.status);
  const location = buildLocation(booking);
  const description = buildDescription({ title, sellerName, booking, notes });

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Appointment Details</p>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-muted-foreground" />
          <div>
            <p className="text-[11px] text-muted-foreground">Date</p>
            <p className="text-sm font-semibold">{format(bookingDate, 'MMM d, yyyy')}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-muted-foreground" />
          <div>
            <p className="text-[11px] text-muted-foreground">Time</p>
            <p className="text-sm font-semibold">
              {booking.start_time.slice(0, 5)} - {booking.end_time.slice(0, 5)}
            </p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3 text-xs text-muted-foreground">
        <MapPin size={12} />
        <span>{location}</span>
      </div>

      <span className={`inline-block text-[10px] px-2 py-0.5 rounded-full font-medium mt-2 ${statusConfig.color}`}>
        {statusConfig.label}
      </span>

      <div className="mt-3">
        <CalendarExportButton
          title={title}
          date={booking.booking_date}
          startTime={booking.start_time}
          endTime={booking.end_time}
          location={location}
          description={description}
          className="gap-1.5 text-xs h-8"
        />
      </div>
    </div>
  );
}
