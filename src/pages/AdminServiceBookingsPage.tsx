// @ts-nocheck
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { format, startOfToday, subDays, startOfWeek, startOfMonth } from 'date-fns';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar, Search, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_OPTIONS = ['all', 'requested', 'confirmed', 'scheduled', 'in_progress', 'completed', 'cancelled', 'no_show'];

const DATE_FILTERS = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
];

const STATUS_COLORS: Record<string, string> = {
  requested: 'bg-blue-100 text-blue-700',
  confirmed: 'bg-emerald-100 text-emerald-700',
  scheduled: 'bg-cyan-100 text-cyan-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
  no_show: 'bg-gray-100 text-gray-700',
  rescheduled: 'bg-purple-100 text-purple-700',
};

function getDateFilterValue(dateFilter: string): string | null {
  const today = startOfToday();
  switch (dateFilter) {
    case 'today': return format(today, 'yyyy-MM-dd');
    case 'week': return format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd');
    case 'month': return format(startOfMonth(today), 'yyyy-MM-dd');
    default: return null;
  }
}

export default function AdminServiceBookingsPage() {
  const [statusFilter, setStatusFilter] = useState('all');
  const [dateFilter, setDateFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const navigate = useNavigate();

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['admin-service-bookings', statusFilter, dateFilter],
    queryFn: async () => {
      let query = supabase
        .from('service_bookings')
        .select(`
          id, order_id, booking_date, start_time, end_time, status, location_type, buyer_address,
          buyer_id, seller_id, product_id, created_at,
          product:products!service_bookings_product_id_fkey(name),
          seller:seller_profiles!service_bookings_seller_id_fkey(business_name)
        `)
        .order('booking_date', { ascending: false })
        .order('start_time', { ascending: false })
        .limit(200);

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      const dateFrom = getDateFilterValue(dateFilter);
      if (dateFrom) {
        query = query.gte('booking_date', dateFrom);
        if (dateFilter === 'today') {
          query = query.lte('booking_date', dateFrom);
        }
      }

      const { data, error } = await query;
      if (error) {
        console.error('[AdminServiceBookings] Error:', error);
        return [];
      }
      return data || [];
    },
    staleTime: 2 * 60_000,
  });

  const filtered = searchTerm
    ? bookings.filter((b: any) => {
        const term = searchTerm.toLowerCase();
        return (
          b.product?.name?.toLowerCase().includes(term) ||
          b.buyer?.name?.toLowerCase().includes(term) ||
          b.seller?.business_name?.toLowerCase().includes(term)
        );
      })
    : bookings;

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center gap-2">
        <Calendar size={20} className="text-primary" />
        <h1 className="text-lg font-bold">Service Bookings</h1>
        <Badge variant="secondary" className="ml-auto">{filtered.length}</Badge>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search by name, seller..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>
        <Select value={dateFilter} onValueChange={setDateFilter}>
          <SelectTrigger className="w-[120px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_FILTERS.map((d) => (
              <SelectItem key={d.value} value={d.value} className="text-sm">
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[130px] h-9 text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s} className="text-sm capitalize">
                {s === 'all' ? 'All Statuses' : s.replace('_', ' ')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground text-sm">
            No service bookings found
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((booking: any) => (
            <Card
              key={booking.id}
              className="cursor-pointer hover:border-primary/20 transition-colors"
              onClick={() => navigate(`/orders/${booking.order_id}`)}
            >
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="min-w-[60px] text-center">
                    <p className="text-xs font-semibold">{booking.booking_date ? format(new Date(booking.booking_date + 'T00:00'), 'MMM d') : '—'}</p>
                    <p className="text-[10px] text-muted-foreground">{booking.start_time?.slice(0, 5) || ''}</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{booking.product?.name || 'Service'}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {booking.buyer?.name || 'Buyer'} → {booking.seller?.business_name || 'Seller'}
                    </p>
                    {(booking.location_type === 'home_visit' || booking.location_type === 'at_buyer') && booking.buyer_address && (
                      <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 mt-0.5 truncate">
                        <MapPin size={8} /> {booking.buyer_address}
                      </p>
                    )}
                  </div>
                  <Badge variant="secondary" className={cn('text-[9px] shrink-0', STATUS_COLORS[booking.status] || '')}>
                    {booking.status}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
