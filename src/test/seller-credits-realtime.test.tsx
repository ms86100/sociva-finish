import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const realtime = vi.hoisted(() => {
  let subscribed = false;
  const chain = {
    on: vi.fn(),
    subscribe: vi.fn(),
  };
  chain.on.mockImplementation(() => {
    if (subscribed) {
      throw new Error('cannot add `postgres_changes` callbacks after `subscribe()`.');
    }
    return chain;
  });
  chain.subscribe.mockImplementation(() => {
    subscribed = true;
    return chain;
  });

  const leftover = { topic: 'realtime:seller-credits-store-1' };
  let leftovers: unknown[] = [];

  return {
    chain,
    leftover,
    channel: vi.fn(() => chain),
    removeChannel: vi.fn(),
    getChannels: vi.fn(() => leftovers),
    setLeftovers: (next: unknown[]) => {
      leftovers = next;
    },
    reset: () => {
      subscribed = false;
      leftovers = [];
      chain.on.mockClear();
      chain.subscribe.mockClear();
    },
  };
});

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    channel: realtime.channel,
    removeChannel: realtime.removeChannel,
    getChannels: realtime.getChannels,
  },
}));

import {
  resetSellerCreditRealtimeBusForTests,
  sellerCreditRealtimeChannelName,
  sellerCreditRealtimeSubscriberCount,
  subscribeSellerCreditRealtime,
} from '@/lib/seller-credits-realtime-bus';
import { useSellerCreditRealtime } from '@/hooks/queries/useSellerCredits';

function DualCreditRealtime({ sellerId }: { sellerId: string }) {
  useSellerCreditRealtime([sellerId]);
  useSellerCreditRealtime([sellerId]);
  return null;
}

describe('seller credit realtime bus', () => {
  beforeEach(() => {
    resetSellerCreditRealtimeBusForTests();
    realtime.reset();
    realtime.channel.mockClear();
    realtime.removeChannel.mockClear();
    realtime.getChannels.mockClear();
  });

  afterEach(() => {
    cleanup();
    resetSellerCreditRealtimeBusForTests();
  });

  it('opens one channel for two subscribers and does not .on() after subscribe()', () => {
    const sellerId = '23670a47-3c4f-4621-a091-91868ff2d981';
    const first = subscribeSellerCreditRealtime([sellerId], () => {});
    const second = subscribeSellerCreditRealtime([sellerId], () => {});

    expect(realtime.channel).toHaveBeenCalledTimes(1);
    expect(realtime.channel).toHaveBeenCalledWith(sellerCreditRealtimeChannelName([sellerId]));
    expect(realtime.chain.subscribe).toHaveBeenCalledTimes(1);
    expect(realtime.chain.on).toHaveBeenCalledTimes(2);
    expect(sellerCreditRealtimeSubscriberCount([sellerId])).toBe(2);

    first();
    expect(realtime.removeChannel).not.toHaveBeenCalled();
    expect(sellerCreditRealtimeSubscriberCount([sellerId])).toBe(1);

    second();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    expect(sellerCreditRealtimeSubscriberCount([sellerId])).toBe(0);
  });

  it('removes a leftover subscribed channel before opening a new one', () => {
    realtime.setLeftovers([realtime.leftover]);
    const stop = subscribeSellerCreditRealtime(['store-1'], () => {});
    expect(realtime.removeChannel).toHaveBeenCalledWith(realtime.leftover);
    expect(realtime.channel).toHaveBeenCalledTimes(1);
    expect(realtime.chain.subscribe).toHaveBeenCalledTimes(1);
    stop();
  });

  it('lets the dashboard and journey banner share one hook subscription', () => {
    const sellerId = '23670a47-3c4f-4621-a091-91868ff2d981';
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <DualCreditRealtime sellerId={sellerId} />
      </QueryClientProvider>,
    );

    expect(realtime.channel).toHaveBeenCalledTimes(1);
    expect(realtime.chain.subscribe).toHaveBeenCalledTimes(1);
    expect(realtime.chain.on).toHaveBeenCalledTimes(2);
    expect(sellerCreditRealtimeSubscriberCount([sellerId])).toBe(2);

    unmount();
    expect(realtime.removeChannel).toHaveBeenCalledTimes(1);
    expect(sellerCreditRealtimeSubscriberCount([sellerId])).toBe(0);
  });
});
