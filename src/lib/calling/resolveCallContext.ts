export type VoipContextType =
  | 'cleaner_city_ride'
  | 'order'
  | 'seller_order'
  | 'helphub'
  | 'booking'
  | 'delivery';

export type ResolvedCallContext = {
  contextType: VoipContextType;
  contextId: string;
  label: string;
};

export function resolveCleanerCityRideCall(rideId: string): ResolvedCallContext {
  return {
    contextType: 'cleaner_city_ride',
    contextId: rideId,
    label: 'Cleaner City ride call',
  };
}

export function resolveOrderCall(orderId: string, asSeller = false): ResolvedCallContext {
  return {
    contextType: asSeller ? 'seller_order' : 'order',
    contextId: orderId,
    label: 'Order call',
  };
}
