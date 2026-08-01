// @ts-nocheck
import { Button } from '@/components/ui/button';
import { CalendarPlus } from 'lucide-react';
import { addToCalendar } from '@/lib/calendar';
import { toast } from 'sonner';

interface CalendarExportButtonProps {
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  location?: string;
  description?: string;
}

export function CalendarExportButton(props: CalendarExportButtonProps) {
  const handleExport = async () => {
    try {
      const ensureSeconds = (t: string) => t.length === 5 ? t + ':00' : t;
      const start = new Date(`${props.date}T${ensureSeconds(props.startTime)}`);
      const end = new Date(`${props.date}T${ensureSeconds(props.endTime)}`);
      await addToCalendar({
        title: props.title,
        startDate: start,
        endDate: end,
        location: props.location,
        description: props.description,
      });
    } catch (e) {
      console.warn('[Calendar] Export failed:', e);
      toast.error('Could not add to calendar');
    }
  };

  return (
    <Button variant="outline" size="sm" className="gap-1.5 text-xs h-7" onClick={handleExport}>
      <CalendarPlus size={12} />
      Add to Calendar
    </Button>
  );
}
