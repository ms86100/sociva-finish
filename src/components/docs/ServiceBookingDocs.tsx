// @ts-nocheck
import { DocHero, DocSection, DocSubSection, DocStep, DocInfoCard, DocList, DocTable } from './DocPrimitives';
import { Calendar } from 'lucide-react';

export function ServiceBookingDocs() {
  return (
    <div>
      <DocHero
        icon={Calendar}
        title="Service Booking"
        subtitle="Category-driven booking flows with time-slot selection, date ranges, duration fields, and booking management."
      />

      <DocSection title="Booking Flow Overview" id="booking-flow">
        <p>When a product's action type is "book" or "request_service", the BookingSheet component opens as a bottom drawer. The form fields are dynamically determined by the category's configuration in the category_config table.</p>

        <DocTable
          headers={['Category Config Field', 'UI Element', 'Example Categories']}
          rows={[
            ['requires_time_slot = true', 'TimeSlotPicker with calendar + time grid', 'Home cleaning, tutoring, salon'],
            ['has_date_range = true', 'DateRangePicker for rental-type bookings', 'Equipment rental, vehicle rental'],
            ['has_duration = true', 'Duration selector input', 'Fitness classes, consultation'],
            ['enquiry_only = true', 'Simple contact/enquiry form', 'Interior design, custom services'],
          ]}
        />
      </DocSection>

      <DocSection title="BookingSheet Component" id="booking-sheet">
        <DocList items={[
          'Sheet title varies: "Contact Seller" (enquiry), "Reserve Rental" (date range), "Book Service" (default)',
          'Uses useCategoryBehavior hook to determine which fields to show',
          'Notes/special instructions textarea always available',
          'Price display with currency formatting (useCurrency hook)',
          'Confirm button label varies: "Send Enquiry", "Confirm Rental", "Confirm Booking"',
          'Creates order with type: enquiry, rental, or booking',
          'Loading state on confirm button during submission',
        ]} />
      </DocSection>

      <DocSection title="TimeSlotPicker" id="time-slot-picker">
        <DocList items={[
          'Calendar date selection for booking date (up to maxBookingDays ahead, default 30)',
          'Respects seller\'s availability_start and availability_end from seller_profiles',
          'Generates time slots at configurable intervals within operating hours',
          'Past time slots for today are automatically grayed out',
          'Unavailable dates can be blocked (unavailableDates prop)',
          'Selected slot highlighted with primary color',
          'Shows slot capacity vs. booked count (from service_slots table)',
        ]} />
      </DocSection>

      <DocSection title="DateRangePicker" id="date-range-picker">
        <DocList items={[
          'Start date and end date selection',
          'Maximum range: 90 days ahead',
          'Price calculation: daily rate × number of selected days',
          'Shows total price dynamically as dates change',
          'Currency formatting via useCurrency hook',
        ]} />
      </DocSection>

      <DocSection title="Service Slot Booking (Database)" id="slot-booking">
        <p>The booking process uses atomic database operations for consistency:</p>
        <DocList items={[
          'book_service_slot() function: atomically increments slot booked_count with row lock',
          'Checks for duplicate bookings (same buyer + same slot)',
          'Checks for overlapping bookings (same buyer, same date, overlapping time)',
          'Prevents booking past dates and past time slots',
          'Creates service_bookings record with status "requested"',
          'Returns success/error JSON response',
        ]} />

        <DocInfoCard variant="info" title="Cancellation & Rescheduling">
          <DocList items={[
            'can_cancel_booking() — checks cancellation policy (notice hours, fee percentage)',
            'Sellers can always cancel; buyers subject to notice period',
            'Late cancellation fee applies if within cancellation_notice_hours',
            'reschedule_service_booking() — atomically releases old slot and books new one',
            'Rescheduling subject to rescheduling_notice_hours policy',
            'Both parties notified via notification_queue on reschedule',
          ]} />
        </DocInfoCard>
      </DocSection>

      <DocSection title="Order Status Flow for Services" id="status-flow">
        <p>Service bookings follow category-specific flows defined in category_status_flows table:</p>
        <DocTable
          headers={['Status', 'Actor', 'Description']}
          rows={[
            ['pending/requested', 'System', 'Initial state after booking'],
            ['confirmed', 'Seller', 'Seller accepts the booking'],
            ['scheduled', 'System', 'Booking date/time confirmed'],
            ['rescheduled', 'Either', 'Date/time changed by buyer or seller'],
            ['in_progress', 'Seller', 'Service is being delivered'],
            ['completed', 'Seller', 'Service finished'],
            ['cancelled', 'Either', 'Booking cancelled'],
            ['no_show', 'Seller', 'Buyer did not show up'],
          ]}
        />
        <p>The get_allowed_transitions() function returns valid next statuses based on current status, category, and actor (buyer/seller).</p>
      </DocSection>
    </div>
  );
}
