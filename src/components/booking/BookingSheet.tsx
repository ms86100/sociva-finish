// @ts-nocheck
import { useState } from 'react';
import { format } from 'date-fns';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { TimeSlotPicker } from './TimeSlotPicker';
import { DateRangePicker } from './DateRangePicker';
import { Listing } from '@/components/listing/ListingCard';
import { useCategoryBehavior } from '@/hooks/useCategoryBehavior';
import { RentalPeriodType } from '@/types/categories';
import { Clock, Calendar, MessageCircle, Loader2 } from 'lucide-react';
import { useCurrency } from '@/hooks/useCurrency';

interface BookingSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  listing: Listing;
  onConfirm: (bookingDetails: BookingDetails) => void;
  isLoading?: boolean;
}

export interface BookingDetails {
  listingId: string;
  type: 'booking' | 'rental' | 'enquiry';
  scheduledDate?: string;
  scheduledTimeStart?: string;
  scheduledTimeEnd?: string;
  rentalStartDate?: string;
  rentalEndDate?: string;
  notes?: string;
  totalAmount: number;
  depositAmount?: number;
}

export function BookingSheet({
  open,
  onOpenChange,
  listing,
  onConfirm,
  isLoading = false,
}: BookingSheetProps) {
  const { requiresTimeSlot, hasDateRange, enquiryOnly, hasDuration } = useCategoryBehavior(listing.category);
  const { formatPrice } = useCurrency();

  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | undefined>();
  const [rentalStartDate, setRentalStartDate] = useState<Date | undefined>();
  const [rentalEndDate, setRentalEndDate] = useState<Date | undefined>();
  const [notes, setNotes] = useState('');

  const handleConfirm = () => {
    const details: BookingDetails = {
      listingId: listing.id,
      type: enquiryOnly ? 'enquiry' : hasDateRange ? 'rental' : 'booking',
      totalAmount: listing.price,
      notes: notes || undefined,
    };

    if (requiresTimeSlot || hasDuration) {
      if (!selectedDate || !selectedTime) return;
      
      details.scheduledDate = format(selectedDate, 'yyyy-MM-dd');
      details.scheduledTimeStart = selectedTime;
      
      // Calculate end time based on duration
      if (listing.service_duration_minutes) {
        const [hours, mins] = selectedTime.split(':').map(Number);
        const endMins = hours * 60 + mins + listing.service_duration_minutes;
        const endHours = Math.floor(endMins / 60);
        const endMinutes = endMins % 60;
        details.scheduledTimeEnd = `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
      }
    }

    if (hasDateRange) {
      if (!rentalStartDate || !rentalEndDate) return;
      
      details.rentalStartDate = format(rentalStartDate, 'yyyy-MM-dd');
      details.rentalEndDate = format(rentalEndDate, 'yyyy-MM-dd');
      details.depositAmount = listing.deposit_amount;
      
      // Calculate total based on rental period
      // This is simplified - actual calculation should consider rental_period_type
      const days = Math.ceil((rentalEndDate.getTime() - rentalStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      details.totalAmount = days * listing.price;
    }

    onConfirm(details);
  };

  const isValid = () => {
    if (enquiryOnly) return true;
    if (requiresTimeSlot || hasDuration) return selectedDate && selectedTime;
    if (hasDateRange) return rentalStartDate && rentalEndDate;
    return false;
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-4">
          <DrawerTitle>
            {enquiryOnly ? 'Contact Seller' : hasDateRange ? 'Reserve Rental' : 'Book Service'}
          </DrawerTitle>
        </DrawerHeader>

        <div className="space-y-6 overflow-y-auto pb-20 px-4">
          {/* Listing Summary */}
          <div className="flex gap-3 p-3 bg-muted rounded-lg">
            {listing.image_url && (
              <img
                src={listing.image_url}
                alt={listing.name}
                className="w-16 h-16 rounded-lg object-cover"
              />
            )}
            <div className="flex-1">
              <h4 className="font-medium">{listing.name}</h4>
              <p className="text-lg font-bold text-primary tabular-nums">{formatPrice(listing.price)}</p>
              {listing.service_duration_minutes && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock size={10} />
                  {listing.service_duration_minutes} min session
                </p>
              )}
            </div>
          </div>

          {/* Time Slot Picker for Services */}
          {(requiresTimeSlot || hasDuration) && !hasDateRange && (
            <TimeSlotPicker
              selectedDate={selectedDate}
              selectedTime={selectedTime}
              onDateSelect={setSelectedDate}
              onTimeSelect={setSelectedTime}
              serviceDuration={listing.service_duration_minutes}
            />
          )}

          {/* Date Range Picker for Rentals */}
          {hasDateRange && (
            <DateRangePicker
              startDate={rentalStartDate}
              endDate={rentalEndDate}
              onStartDateSelect={setRentalStartDate}
              onEndDateSelect={setRentalEndDate}
              pricePerPeriod={listing.price}
              rentalPeriodType={listing.rental_period_type as RentalPeriodType}
              depositAmount={listing.deposit_amount}
            />
          )}

          {/* Notes/Message */}
          <div className="space-y-2">
            <label className="text-sm font-medium flex items-center gap-2">
              <MessageCircle size={14} />
              {enquiryOnly ? 'Your Message' : 'Special Requests (Optional)'}
            </label>
            <Textarea
              placeholder={
                enquiryOnly
                  ? 'Hi, I\'m interested in this item. Is it still available?'
                  : 'Any specific requirements or requests...'
              }
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        {/* Confirm Button */}
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-background border-t">
          <Button
            className="w-full"
            size="lg"
            disabled={!isValid() || isLoading}
            onClick={handleConfirm}
          >
            {isLoading ? (
              <Loader2 className="animate-spin mr-2" size={18} />
            ) : null}
            {enquiryOnly
              ? 'Send Enquiry'
              : hasDateRange
              ? 'Confirm Rental'
              : 'Confirm Booking'}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
