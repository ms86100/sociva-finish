// @ts-nocheck
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { format, differenceInHours } from 'date-fns';
import { Calendar, Clock, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

interface UpcomingBooking {
  id: string;
  order_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  status: string;
  product_name?: string;
  seller_name?: string;
}

function timeToMinutes(t: string): number {
  const parts = t.split(':').map(Number);
  return (parts[0] || 0) * 60 + (parts[1] || 0);
}

export function UpcomingAppointmentBanner() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [booking, setBooking] = useState<UpcomingBooking | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    const handler = () => setRefreshKey(k => k + 1);
    window.addEventListener('booking-changed', handler);
    return () => window.removeEventListener('booking-changed', handler);
  }, []);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    (async () => {
      // Use IST for date/time comparisons — booking dates are stored as IST dates
      const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      const today = format(nowIST, 'yyyy-MM-dd');
      const { data } = await supabase
        .from('service_bookings')
        .select('id, order_id, booking_date, start_time, end_time, status, product:products!service_bookings_product_id_fkey(name, seller_id)')
        .eq('buyer_id', user.id)
        .gte('booking_date', today)
        .not('status', 'in', '(cancelled,completed,no_show)')
        .order('booking_date', { ascending: true })
        .order('start_time', { ascending: true })
        .limit(5);

      if (cancelled || !data || data.length === 0) {
        if (!cancelled) setBooking(null);
        return;
      }

      const nowMinutes = nowIST.getHours() * 60 + nowIST.getMinutes();
      const todayStr = today;
      const validBooking = data.find((b: any) => {
        if (b.booking_date === todayStr && timeToMinutes(b.start_time || '00:00') < nowMinutes) return false;
        return true;
      });

      if (!validBooking) {
        if (!cancelled) setBooking(null);
        return;
      }

      const product = (validBooking as any).product;
      let sellerName = '';
      if (product?.seller_id) {
        const { data: seller } = await supabase
          .from('seller_profiles')
          .select('business_name')
          .eq('id', product.seller_id)
          .single();
        if (!cancelled) sellerName = seller?.business_name || '';
      }

      if (!cancelled) {
        setBooking({
          id: validBooking.id,
          order_id: validBooking.order_id,
          booking_date: validBooking.booking_date,
          start_time: validBooking.start_time,
          end_time: validBooking.end_time,
          status: validBooking.status,
          product_name: product?.name || 'Service',
          seller_name: sellerName,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, refreshKey]);

  if (!booking) return null;

  const [bH, bM] = (booking.start_time || '00:00').split(':').map(Number);
  // Parse appointment time as IST (+05:30) for accurate countdown
  const appointmentDate = new Date(`${booking.booking_date}T${String(bH).padStart(2,'0')}:${String(bM).padStart(2,'0')}:00+05:30`);
  const hoursAway = differenceInHours(appointmentDate, new Date());
  // Compare date strings in IST to determine Today/Tomorrow label
  const nowISTForLabel = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const todayStrForLabel = format(nowISTForLabel, 'yyyy-MM-dd');
  const tomorrowIST = new Date(nowISTForLabel);
  tomorrowIST.setDate(tomorrowIST.getDate() + 1);
  const tomorrowStr = format(tomorrowIST, 'yyyy-MM-dd');
  const dateLabel = booking.booking_date === todayStrForLabel
    ? 'Today'
    : booking.booking_date === tomorrowStr
    ? 'Tomorrow'
    : format(new Date(booking.booking_date + 'T00:00:00+05:30'), 'MMM d');

  const isUrgent = hoursAway <= 2 && hoursAway >= 0;

  return (
    <motion.button
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      onClick={() => navigate(`/orders/${booking.order_id}`)}
      className={`w-full p-3.5 rounded-2xl border flex items-center gap-3 text-left transition-all ${
        isUrgent
          ? 'bg-primary/10 border-primary/30 shadow-sm'
          : 'bg-card border-border hover:border-primary/20 hover:shadow-sm'
      }`}
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
        isUrgent ? 'bg-primary/20' : 'bg-primary/10'
      }`}>
        <Calendar size={18} className="text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-bold truncate text-foreground">{booking.product_name}</p>
        <p className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
          <Clock size={10} />
          {dateLabel} at {booking.start_time?.slice(0, 5)}
          {booking.seller_name && <span> · {booking.seller_name}</span>}
        </p>
      </div>
      <ChevronRight size={16} className="text-muted-foreground shrink-0" />
    </motion.button>
  );
}
