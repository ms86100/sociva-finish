import { describe, it, expect } from 'vitest';
import {
  resolveOrderProgress,
  resolveFulfillmentKind,
  isDeliveryMapEligible,
  progressStageToPhase,
  DELIVERY_PROGRESS_STAGES,
  PICKUP_PROGRESS_STAGES,
  CONTACT_ENQUIRY_PROGRESS_STAGES,
} from '@/lib/orderProgressStages';

describe('orderProgressStages', () => {
  describe('resolveFulfillmentKind', () => {
    it('maps self_pickup and pickup to pickup', () => {
      expect(resolveFulfillmentKind('self_pickup')).toBe('pickup');
      expect(resolveFulfillmentKind('pickup')).toBe('pickup');
    });

    it('maps delivery modes to delivery', () => {
      expect(resolveFulfillmentKind('delivery')).toBe('delivery');
      expect(resolveFulfillmentKind('seller_delivery')).toBe('delivery');
      expect(resolveFulfillmentKind(null)).toBe('delivery');
    });
  });

  describe('delivery rail', () => {
    it('uses Confirmed → Preparing → On the way → Delivered', () => {
      expect(DELIVERY_PROGRESS_STAGES.map((s) => s.label)).toEqual([
        'Confirmed',
        'Preparing',
        'On the way',
        'Delivered',
      ]);
    });

    it('maps placed/pending to stage 1', () => {
      expect(resolveOrderProgress({ status: 'placed', fulfillmentType: 'delivery' }).stageId).toBe(1);
      expect(resolveOrderProgress({ status: 'pending', fulfillmentType: 'delivery' }).stageId).toBe(1);
    });

    it('maps accepted/preparing to stage 2', () => {
      expect(resolveOrderProgress({ status: 'accepted', fulfillmentType: 'delivery' }).stageId).toBe(2);
      expect(resolveOrderProgress({ status: 'preparing', fulfillmentType: 'delivery' }).stageId).toBe(2);
      expect(resolveOrderProgress({ status: 'in_progress', fulfillmentType: 'delivery' }).stageId).toBe(2);
    });

    it('keeps ready/assigned in Preparing (stage 2), not On the way', () => {
      const ready = resolveOrderProgress({ status: 'ready', fulfillmentType: 'delivery' });
      const assigned = resolveOrderProgress({ status: 'assigned', fulfillmentType: 'delivery' });
      expect(ready.stageId).toBe(2);
      expect(assigned.stageId).toBe(2);
      expect(ready.isTransitStage).toBe(false);
      expect(assigned.isTransitStage).toBe(false);
      expect(assigned.subtext).toMatch(/assigned/i);
    });

    it('maps true transit to stage 3', () => {
      for (const status of ['picked_up', 'on_the_way', 'at_gate', 'en_route', 'arrived']) {
        const r = resolveOrderProgress({ status, fulfillmentType: 'delivery' });
        expect(r.stageId).toBe(3);
        expect(r.isTransitStage).toBe(true);
        expect(r.label).toBe('On the way');
      }
    });

    it('maps delivered/completed/COD to stage 4', () => {
      expect(resolveOrderProgress({ status: 'delivered', fulfillmentType: 'delivery' }).stageId).toBe(4);
      expect(resolveOrderProgress({ status: 'completed', fulfillmentType: 'delivery' }).stageId).toBe(4);
      const cod = resolveOrderProgress({
        status: 'awaiting_cod_confirmation',
        fulfillmentType: 'delivery',
      });
      expect(cod.stageId).toBe(4);
      expect(cod.showCodBanner).toBe(true);
    });
  });

  describe('pickup rail', () => {
    it('uses Confirmed → Preparing → Ready for pickup → Picked up', () => {
      expect(PICKUP_PROGRESS_STAGES.map((s) => s.label)).toEqual([
        'Confirmed',
        'Preparing',
        'Ready for pickup',
        'Picked up',
      ]);
      expect(PICKUP_PROGRESS_STAGES[3].key).toBe('buyer_received');
    });

    it('maps ready to stage 3 Ready for pickup', () => {
      const r = resolveOrderProgress({ status: 'ready', fulfillmentType: 'self_pickup' });
      expect(r.stageId).toBe(3);
      expect(r.label).toBe('Ready for pickup');
      expect(r.isTransitStage).toBe(false);
    });

    it('maps buyer_received/completed to stage 4 Picked up', () => {
      const received = resolveOrderProgress({ status: 'buyer_received', fulfillmentType: 'self_pickup' });
      expect(received.stageId).toBe(4);
      expect(received.label).toBe('Picked up');
      const completed = resolveOrderProgress({ status: 'completed', fulfillmentType: 'self_pickup' });
      expect(completed.stageId).toBe(4);
      expect(completed.label).toBe('Picked up');
    });
  });

  describe('contact enquiry rail', () => {
    it('uses Enquiry → Accepted → Delivered instead of cart pickup stages', () => {
      const r = resolveOrderProgress({
        status: 'enquired',
        fulfillmentType: 'self_pickup',
        transactionType: 'contact_enquiry',
      });
      expect(r.journey).toBe('contact_enquiry');
      expect(CONTACT_ENQUIRY_PROGRESS_STAGES.map((s) => s.label)).toEqual([
        'Enquiry',
        'Accepted',
        'Delivered',
      ]);
      expect(r.stages.map((s) => s.label)).toEqual(['Enquiry', 'Accepted', 'Delivered']);
      expect(r.stageId).toBe(1);
      expect(r.label).toBe('Enquiry');
      expect(r.isTransitStage).toBe(false);
    });

    it('maps quoted/accepted to Accepted and completed to Delivered', () => {
      const accepted = resolveOrderProgress({
        status: 'quoted',
        fulfillmentType: 'self_pickup',
        transactionType: 'contact_enquiry',
      });
      expect(accepted.stageId).toBe(2);
      expect(accepted.label).toBe('Accepted');
      const done = resolveOrderProgress({
        status: 'completed',
        fulfillmentType: 'self_pickup',
        transactionType: 'contact_enquiry',
      });
      expect(done.stageId).toBe(3);
      expect(done.label).toBe('Delivered');
      expect(progressStageToPhase(done)).toBe('delivered');
    });

    it('does not change cart pickup labels when transactionType is omitted', () => {
      const r = resolveOrderProgress({ status: 'enquired', fulfillmentType: 'self_pickup' });
      expect(r.journey).toBe('fulfillment');
      expect(r.stages.map((s) => s.label)).toEqual([
        'Confirmed',
        'Preparing',
        'Ready for pickup',
        'Picked up',
      ]);
    });
  });

  describe('end states', () => {
    it('does not force cancelled/rejected/failed into the 4 stages', () => {
      for (const status of ['cancelled', 'rejected', 'failed']) {
        const r = resolveOrderProgress({ status, fulfillmentType: 'delivery' });
        expect(r.kind).toBe('end_state');
        expect(r.stageId).toBeNull();
        expect(progressStageToPhase(r)).toBe('cancelled');
      }
    });
  });

  describe('map eligibility', () => {
    it('never shows map for ready/assigned even if flow says transit', () => {
      expect(isDeliveryMapEligible('ready', true)).toBe(false);
      expect(isDeliveryMapEligible('assigned', true)).toBe(false);
    });

    it('shows map for true transit and flow is_transit custom keys', () => {
      expect(isDeliveryMapEligible('picked_up', false)).toBe(true);
      expect(isDeliveryMapEligible('on_the_way')).toBe(true);
      expect(isDeliveryMapEligible('custom_enroute', true)).toBe(true);
      expect(isDeliveryMapEligible('preparing', false)).toBe(false);
    });
  });

  describe('payment_pending', () => {
    it('stays on stage 1 with pay subtext', () => {
      const r = resolveOrderProgress({ status: 'payment_pending', fulfillmentType: 'delivery' });
      expect(r.stageId).toBe(1);
      expect(r.subtext).toMatch(/payment/i);
    });
  });
});
