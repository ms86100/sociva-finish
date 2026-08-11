// @ts-nocheck
import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format, isBefore, startOfToday } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogDescription, AlertDialogFooter, AlertDialogAction } from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { TimeSlotPicker } from './TimeSlotPicker';
import { ServiceAddonPicker, SelectedAddon } from './ServiceAddonPicker';
import { RecurringBookingSelector, RecurringConfig } from './RecurringBookingSelector';
import { useAuth } from '@/contexts/AuthContext';
import { useCategoryBehavior } from '@/hooks/useCategoryBehavior';
import { useServiceSlots, slotsToPickerFormat } from '@/hooks/useServiceSlots';
import { useSubcategories } from '@/hooks/useSubcategories';
import { supabase } from '@/integrations/supabase/client';
import { useCurrency } from '@/hooks/useCurrency';
import { toast } from 'sonner';
import { Clock, MapPin, MessageCircle, Loader2, ArrowLeft, Calendar, User, Sparkles } from 'lucide-react';
import type { ServiceCategory } from '@/types/categories';
import { notify } from '@/lib/notify';
import { friendlyError } from '@/lib/utils';
import { useFeedbackPopup } from '@/components/FeedbackPopupProvider';

interface ServiceBookingFlowProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productId: string;
  productName: string;
  sellerId: string;
  sellerName: string;
  price: number;
  category: string;
  imageUrl?: string | null;
  durationMinutes?: number;
  locationType?: string;
  subcategoryId?: string | null;
}

const MAX_NOTES_LENGTH = 500;
const MAX_ADDRESS_LENGTH = 300;

type BookingStep = 'select' | 'review';

export function ServiceBookingFlow({
  open, onOpenChange, productId, productName, sellerId, sellerName,
  price, category, imageUrl, durationMinutes, locationType, subcategoryId,
}: ServiceBookingFlowProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { formatPrice } = useCurrency();
  const queryClient = useQueryClient();
  const { config } = useCategoryBehavior(category as ServiceCategory);

  const isSubmittingRef = useRef(false);

  // Bug #2/#3: Fetch service_listings to get correct location_type and duration_minutes
  const { data: serviceListing } = useQuery({
    queryKey: ['service-listing', productId],
    queryFn: async () => {
      const { data } = await supabase
        .from('service_listings')
        .select('location_type, duration_minutes')
        .eq('product_id', productId)
        .maybeSingle();
      return data;
    },
    enabled: open && !!productId,
  });

  const resolvedDuration = serviceListing?.duration_minutes ?? durationMinutes;
  const resolvedLocation = serviceListing?.location_type ?? locationType;

  const { data: serviceSlots = [], refetch: refetchSlots } = useServiceSlots(open ? productId : undefined);
  const availableSlots = useMemo(
    () => slotsToPickerFormat(serviceSlots),
    [serviceSlots]
  );

  const [step, setStep] = useState<BookingStep>('select');
  const [selectedDate, setSelectedDate] = useState<Date | undefined>();
  const [selectedTime, setSelectedTime] = useState<string | undefined>();
  const [notes, setNotes] = useState('');
  const [buyerAddress, setBuyerAddress] = useState('');
  const [selectedAddons, setSelectedAddons] = useState<SelectedAddon[]>([]);
  const [recurringConfig, setRecurringConfig] = useState<RecurringConfig>({ enabled: false, frequency: 'weekly' });
  const [isLoading, setIsLoading] = useState(false);
  const [selfBookError, setSelfBookError] = useState(false);

  useEffect(() => {
    if (open) {
      setStep('select');
      setSelectedDate(undefined);
      setSelectedTime(undefined);
      setNotes('');
      setBuyerAddress('');
      setSelectedAddons([]);
      setRecurringConfig({ enabled: false, frequency: 'weekly' });
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  }, [open]);

  const { data: subcategories = [] } = useSubcategories(config?.id || null);
  const activeSubcategory = useMemo(() => {
    if (!subcategoryId) return null;
    return subcategories.find(s => s.id === subcategoryId) || null;
  }, [subcategoryId, subcategories]);

  // Bug #20 fix: If subcategory not found via category config chain, fetch directly
  const { data: directSubcategory } = useQuery({
    queryKey: ['subcategory-direct', subcategoryId],
    queryFn: async () => {
      if (!subcategoryId) return null;
      const { data } = await supabase
        .from('subcategories')
        .select('supports_addons, supports_recurring, supports_staff_assignment')
        .eq('id', subcategoryId)
        .eq('is_active', true)
        .maybeSingle();
      return data;
    },
    enabled: !!subcategoryId && !activeSubcategory,
  });

  const resolvedSubcategory = activeSubcategory || directSubcategory;
  const supportsAddons = resolvedSubcategory?.supports_addons ?? config?.supportsAddons ?? false;
  const supportsRecurring = resolvedSubcategory?.supports_recurring ?? config?.supportsRecurring ?? false;
  const needsAddress = resolvedLocation === 'home_visit' || resolvedLocation === 'at_buyer';

  const addonTotal = selectedAddons.reduce((s, a) => s + a.price, 0);
  const totalAmount = price + addonTotal;

  const isDateValid = selectedDate && !isBefore(selectedDate, startOfToday());
  const isSelectValid = isDateValid && selectedTime && (!needsAddress || buyerAddress.trim().length > 0);

  const handleDateSelect = (date: Date | undefined) => {
    setSelectedDate(date);
    setSelectedTime(undefined);
  };

  const handleContinueToReview = () => {
    if (!isSelectValid) return;
    setStep('review');
  };

  const handleBackToSelect = () => {
    setStep('select');
  };

  const handleConfirm = async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;

    if (!user) {
      notify.block('Please sign in first');
      navigate('/auth');
      isSubmittingRef.current = false;
      return;
    }
    if (!selectedDate || !selectedTime || !isDateValid) {
      notify.block('Please select a valid date and time');
      isSubmittingRef.current = false;
      return;
    }
    if (needsAddress && !buyerAddress.trim()) {
      notify.block('Please enter your address for home visit');
      isSubmittingRef.current = false;
      return;
    }

    setIsLoading(true);
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd');

      // Pre-flight validations BEFORE creating any DB records
      const { data: sellerProfile } = await supabase
        .from('seller_profiles')
        .select('user_id')
        .eq('id', sellerId)
        .single();

      if (sellerProfile?.user_id === user.id) {
        setSelfBookError(true);
        setIsLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      if (price <= 0) {
        toast.error('Invalid service price');
        setIsLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      const normalizedTime = selectedTime.length === 5 ? selectedTime + ':00' : selectedTime;

      const { data: freshProduct } = await supabase
        .from('products')
        .select('is_available, approval_status')
        .eq('id', productId)
        .single();

      if (!freshProduct || !freshProduct.is_available || freshProduct.approval_status !== 'approved') {
        toast.error('This service is no longer available.');
        setIsLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      const { data: freshSlots } = await supabase
        .from('service_slots')
        .select('*')
        .eq('seller_id', sellerId)
        .is('product_id', null)
        .eq('slot_date', dateStr)
        .eq('start_time', normalizedTime)
        .eq('is_blocked', false)
        .maybeSingle();

      if (!freshSlots || freshSlots.booked_count >= freshSlots.max_capacity) {
        toast.error('Selected slot is no longer available. Refreshing...');
        refetchSlots();
        setIsLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      const slot = freshSlots;
      const effectiveLocationType = resolvedLocation || locationType || 'at_seller';
      const idempotencyKey = `booking_${user.id}_${productId}_${dateStr}_${normalizedTime}`;

      const { data: bookResult, error: bookErr } = await supabase.rpc('create_service_booking_atomic', {
        _seller_id: sellerId,
        _product_id: productId,
        _slot_id: slot.id,
        _booking_date: dateStr,
        _start_time: slot.start_time,
        _end_time: slot.end_time,
        _total_amount: totalAmount,
        _product_name: productName,
        _unit_price: price,
        _idempotency_key: idempotencyKey,
        _notes: notes.trim().slice(0, MAX_NOTES_LENGTH) || null,
        _buyer_address: needsAddress && buyerAddress.trim()
          ? buyerAddress.trim().slice(0, MAX_ADDRESS_LENGTH)
          : null,
        _location_type: effectiveLocationType,
        _fulfillment_type: effectiveLocationType,
        _addons: selectedAddons.map((a) => ({
          id: a.id,
          name: a.name || 'Add-on',
          price: a.price,
        })),
        _recurring: recurringConfig.enabled
          ? {
              enabled: true,
              frequency: recurringConfig.frequency,
              endDate: recurringConfig.endDate || null,
              dayOfWeek: selectedDate.getDay(),
            }
          : null,
      });

      if (bookErr) throw bookErr;

      const result = bookResult as {
        success?: boolean;
        error?: string;
        order_id?: string;
        booking_id?: string;
      } | null;
      if (!result?.success) {
        toast.error(result?.error || 'Failed to create booking');
        refetchSlots();
        setIsLoading(false);
        isSubmittingRef.current = false;
        return;
      }

      const orderId = result.order_id;
      if (!orderId) throw new Error('Booking succeeded but no order_id returned');

      supabase.functions.invoke('process-notification-queue').catch(() => {});

      queryClient.invalidateQueries({ queryKey: ['service-slots', productId] });
      queryClient.invalidateQueries({ queryKey: ['service-slots-store', productId] });
      queryClient.invalidateQueries({ queryKey: ['seller-service-bookings'] });
      queryClient.invalidateQueries({ queryKey: ['buyer-service-bookings'] });
      window.dispatchEvent(new Event('booking-changed'));

      const { showFeedback } = useFeedbackPopup();
      showFeedback({
        title: 'Booking confirmed!',
        variant: 'success'
      });
      onOpenChange(false);
      navigate(`/orders/${orderId}`);
    } catch (err: any) {
      console.error('Service booking error:', err);
      toast.error(friendlyError(err) || 'Failed to create booking. Please try again.');
    } finally {
      setIsLoading(false);
      isSubmittingRef.current = false;
    }
  };

  const resolvedLocationType = resolvedLocation || 'at_seller';
  const locationLabel = resolvedLocationType === 'home_visit' || resolvedLocationType === 'at_buyer'
    ? 'Home Visit'
    : resolvedLocationType === 'online'
    ? 'Online'
    : 'At Seller Location';

  return (
    <>
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-4">
          <DrawerTitle className="flex items-center gap-2">
            {step === 'review' && (
              <Button variant="ghost" size="icon" className="h-7 w-7 -ml-1" onClick={handleBackToSelect}>
                <ArrowLeft size={16} />
              </Button>
            )}
            {step === 'select' ? 'Book Service' : 'Review Booking'}
          </DrawerTitle>
        </DrawerHeader>

        <div className="space-y-6 overflow-y-auto pb-24 px-4">
          <AnimatePresence mode="wait">
          {step === 'select' && (
            <motion.div
              key="select"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            >
              {/* Summary */}
              <div className="flex gap-3 p-3 bg-muted rounded-lg">
                {imageUrl && (
                  <img src={imageUrl} alt={productName} className="w-16 h-16 rounded-lg object-cover" />
                )}
                <div className="flex-1">
                  <h4 className="font-medium">{productName}</h4>
                  <p className="text-xs text-muted-foreground">{sellerName}</p>
                  <p className="text-lg font-bold text-primary tabular-nums">{formatPrice(price)}</p>
                  {resolvedDuration && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock size={10} />{resolvedDuration} min session
                    </p>
                  )}
                </div>
              </div>

              {/* Time Slot Picker */}
              <TimeSlotPicker
                selectedDate={selectedDate}
                selectedTime={selectedTime}
                onDateSelect={handleDateSelect}
                onTimeSelect={setSelectedTime}
                serviceDuration={resolvedDuration}
                availableSlots={availableSlots}
              />

              {/* Address for home visit */}
              {needsAddress && (
                <div className="space-y-2">
                  <label className="text-sm font-medium flex items-center gap-2">
                    <MapPin size={14} />Your Address (required for home visit)
                  </label>
                  <Input
                    placeholder="Enter your full address..."
                    value={buyerAddress}
                    onChange={(e) => setBuyerAddress(e.target.value.slice(0, MAX_ADDRESS_LENGTH))}
                    maxLength={MAX_ADDRESS_LENGTH}
                  />
                  {needsAddress && buyerAddress.trim().length === 0 && (
                    <p className="text-[10px] text-destructive">Address is required for home visit services</p>
                  )}
                </div>
              )}

              {/* Add-ons */}
              {supportsAddons && (
                <ServiceAddonPicker
                  productId={productId}
                  selectedAddons={selectedAddons}
                  onAddonsChange={setSelectedAddons}
                />
              )}

              {/* Recurring */}
              {supportsRecurring && selectedDate && selectedTime && (
                <RecurringBookingSelector
                  config={recurringConfig}
                  onChange={setRecurringConfig}
                />
              )}

              {/* Notes */}
              <div className="space-y-2">
                <label className="text-sm font-medium flex items-center gap-2">
                  <MessageCircle size={14} />Special Requests (Optional)
                </label>
                <Textarea
                  placeholder="Any specific requirements or requests..."
                  value={notes}
                  onChange={(e) => setNotes(e.target.value.slice(0, MAX_NOTES_LENGTH))}
                  rows={3}
                  maxLength={MAX_NOTES_LENGTH}
                />
                <p className="text-[10px] text-muted-foreground text-right">{notes.length}/{MAX_NOTES_LENGTH}</p>
              </div>
            </motion.div>
          )}

          {step === 'review' && selectedDate && selectedTime && (
            <motion.div
              key="review"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="space-y-4"
            >
              {/* Service info */}
              <div className="flex gap-3 p-3 bg-muted rounded-lg">
                {imageUrl && (
                  <img src={imageUrl} alt={productName} className="w-16 h-16 rounded-lg object-cover" />
                )}
                <div className="flex-1">
                  <h4 className="font-medium">{productName}</h4>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <User size={10} />{sellerName}
                  </p>
                </div>
              </div>

              {/* Date & Time */}
              <div className="p-3 rounded-lg border border-border space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Calendar size={14} className="text-primary" />
                  <span className="font-medium">{format(selectedDate, 'EEEE, MMMM d, yyyy')}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Clock size={14} className="text-primary" />
                  <span>{selectedTime?.slice(0, 5)}</span>
                  {resolvedDuration && (
                    <span className="text-muted-foreground">· {resolvedDuration} min</span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <MapPin size={14} className="text-primary" />
                  <span>{locationLabel}</span>
                </div>
                {needsAddress && buyerAddress.trim() && (
                  <p className="text-xs text-muted-foreground pl-5">{buyerAddress}</p>
                )}
              </div>

              {/* Add-ons */}
              {selectedAddons.length > 0 && (
                <div className="p-3 rounded-lg border border-border space-y-1.5">
                  <p className="text-xs font-medium flex items-center gap-1 text-muted-foreground">
                    <Sparkles size={10} className="text-primary" />Add-ons
                  </p>
                  {selectedAddons.map((addon) => (
                    <div key={addon.id} className="flex items-center justify-between text-xs">
                      <span>{addon.name}</span>
                      <span className="font-medium tabular-nums">{formatPrice(addon.price)}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Notes */}
              {notes.trim() && (
                <div className="p-3 rounded-lg border border-border">
                  <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
                    <MessageCircle size={10} />Notes
                  </p>
                  <p className="text-sm">{notes}</p>
                </div>
              )}

              {/* Recurring */}
              {recurringConfig.enabled && (
                <div className="p-3 rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground">
                    Recurring: <span className="font-medium capitalize">{recurringConfig.frequency}</span>
                    {recurringConfig.endDate && ` until ${recurringConfig.endDate}`}
                  </p>
                </div>
              )}

              {/* Price breakdown */}
              <div className="p-3 rounded-lg bg-muted space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>Service</span>
                  <span className="tabular-nums">{formatPrice(price)}</span>
                </div>
                {addonTotal > 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Add-ons</span>
                    <span className="tabular-nums">{formatPrice(addonTotal)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold pt-1.5 border-t border-border">
                  <span>Total</span>
                  <span className="text-primary tabular-nums">{formatPrice(totalAmount)}</span>
                </div>
              </div>
            </motion.div>
          )}
          </AnimatePresence>
        </div>

        {/* Bottom CTA */}
        <div className="absolute bottom-0 left-0 right-0 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-background border-t">
          {step === 'select' ? (
            <Button className="w-full" size="lg" disabled={!isSelectValid} onClick={handleContinueToReview} whileTap={{ scale: 0.97 }} as={motion.button}>
              Continue · {formatPrice(totalAmount)}
            </Button>
          ) : (
            <Button className="w-full" size="lg" disabled={isLoading} onClick={handleConfirm}>
              {isLoading && <Loader2 className="animate-spin mr-2" size={18} />}
              Confirm Booking · {formatPrice(totalAmount)}
            </Button>
          )}
        </div>
      </DrawerContent>
    </Drawer>

    <AlertDialog open={selfBookError} onOpenChange={setSelfBookError}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cannot Book Own Service</AlertDialogTitle>
          <AlertDialogDescription>
            You cannot book your own service. Please ask someone else to make this booking.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogAction onClick={() => setSelfBookError(false)}>OK</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
