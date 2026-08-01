// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { CalendarCheck, Clock, ListChecks, BookOpen, ChevronRight, Sparkles } from 'lucide-react';
import { ServiceBookingStats } from '@/components/seller/ServiceBookingStats';
import { SellerScheduleView } from '@/components/seller/SellerScheduleView';
import { SlotsManager } from '@/components/seller/SlotsManager';
import { ServiceAvailabilityManager } from '@/components/seller/ServiceAvailabilityManager';

interface BookingsHubProps { sellerId: string; }

export function BookingsHub({ sellerId }: BookingsHubProps) {
  const [tab, setTab] = useState('bookings');

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-sm">Bookings & Availability</h3>
          <p className="text-[11px] text-muted-foreground">Manage schedule, slots, and customer bookings in one place</p>
        </div>
        <Link to="/seller/products">
          <Button variant="outline" size="sm" className="h-7 text-xs">Services</Button>
        </Link>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid grid-cols-4 w-full h-9">
          <TabsTrigger value="bookings" className="text-[11px] gap-1"><CalendarCheck size={12} /><span className="hidden sm:inline">Bookings</span></TabsTrigger>
          <TabsTrigger value="slots" className="text-[11px] gap-1"><ListChecks size={12} /><span className="hidden sm:inline">Slots</span></TabsTrigger>
          <TabsTrigger value="hours" className="text-[11px] gap-1"><Clock size={12} /><span className="hidden sm:inline">Hours</span></TabsTrigger>
          <TabsTrigger value="rules" className="text-[11px] gap-1"><BookOpen size={12} /><span className="hidden sm:inline">Rules</span></TabsTrigger>
        </TabsList>

        <TabsContent value="bookings" className="space-y-3 mt-3">
          <ServiceBookingStats sellerId={sellerId} />
          <SellerScheduleView sellerId={sellerId} />
        </TabsContent>

        <TabsContent value="slots" className="mt-3">
          <SlotsManager sellerId={sellerId} />
        </TabsContent>

        <TabsContent value="hours" className="mt-3 space-y-3">
          <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20">
            <Sparkles size={14} className="text-primary mt-0.5 shrink-0" />
            <p className="text-[11px] text-foreground/80 leading-relaxed">
              Slots now <strong>auto-generate</strong> whenever you save your hours. You no longer need to manually regenerate — the system rebuilds future unbooked slots automatically. Use the <strong>Slots</strong> tab to block individual times.
            </p>
          </div>
          <ServiceAvailabilityManager sellerId={sellerId} />
        </TabsContent>

        <TabsContent value="rules" className="mt-3 space-y-3">
          <div className="bg-card border rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-primary" />
              <h4 className="font-semibold text-sm">How bookings work</h4>
            </div>
            <ul className="text-[12px] text-muted-foreground space-y-2 leading-relaxed">
              <li className="flex gap-2"><span className="text-primary">•</span><span>All booking slots are <strong>automatically derived</strong> from each service's duration, buffer, and your working hours.</span></li>
              <li className="flex gap-2"><span className="text-primary">•</span><span>Slots regenerate when you change duration, buffer, working hours, or approve a new bookable service.</span></li>
              <li className="flex gap-2"><span className="text-primary">•</span><span>The slot window rolls forward <strong>30 days</strong> ahead and extends daily.</span></li>
              <li className="flex gap-2"><span className="text-primary">•</span><span>To take a break or vacation, block individual slots or an entire date range from the <strong>Slots</strong> tab.</span></li>
              <li className="flex gap-2"><span className="text-primary">•</span><span>Cancellation / reschedule notice windows are set on each service in its <strong>Service Config</strong>.</span></li>
            </ul>
          </div>

          <Link to="/seller/products" className="flex items-center justify-between px-4 py-3 bg-card border rounded-xl hover:bg-accent/5">
            <div>
              <p className="text-sm font-semibold">Edit service configuration</p>
              <p className="text-[11px] text-muted-foreground">Duration, buffer, capacity, cancellation rules</p>
            </div>
            <ChevronRight size={16} className="text-muted-foreground" />
          </Link>
        </TabsContent>
      </Tabs>
    </div>
  );
}
