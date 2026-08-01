// @ts-nocheck
// Service booking domain types

export type ServiceType = 'scheduled' | 'on_demand' | 'group' | 'recurring';
export type ServiceLocationType = 'home_visit' | 'at_seller' | 'online';
export type ServicePriceModel = 'fixed' | 'hourly' | 'tiered';

export interface ServiceListing {
  id: string;
  product_id: string;
  service_type: ServiceType;
  location_type: ServiceLocationType;
  duration_minutes: number;
  buffer_minutes: number;
  max_bookings_per_slot: number;
  price_model: ServicePriceModel;
  cancellation_notice_hours: number;
  rescheduling_notice_hours: number;
  cancellation_fee_percentage: number;
  created_at: string;
  updated_at: string;
}

export interface ServiceAvailabilitySchedule {
  id: string;
  seller_id: string;
  product_id: string | null;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: boolean;
  created_at: string;
}

export interface ServiceSlot {
  id: string;
  product_id: string;
  seller_id: string;
  slot_date: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  booked_count: number;
  is_blocked: boolean;
  created_at: string;
}

export interface ServiceBooking {
  id: string;
  order_id: string;
  slot_id: string;
  buyer_id: string;
  seller_id: string;
  product_id: string;
  booking_date: string;
  start_time: string;
  end_time: string;
  location_type: ServiceLocationType;
  buyer_address: string | null;
  status: string;
  rescheduled_from: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
}

