import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropRunPanel } from '@/components/cleaner-city/ride/DropRunPanel';
import type { DropOrderPersisted } from '@/lib/cleaner-city/dropRun';
import { guestStopId } from '@/lib/cleaner-city/dropRun';

const openMaps = vi.fn();
vi.mock('@/lib/cleaner-city/routing', async () => {
  const actual = await vi.importActual<typeof import('@/lib/cleaner-city/routing')>(
    '@/lib/cleaner-city/routing',
  );
  return {
    ...actual,
    openGoogleMapsDirections: (...args: unknown[]) => openMaps(...args),
  };
});

const GREENFIELD = { lat: 12.8948, lng: 77.6719 };
const WHITEFIELD = { lat: 12.9698, lng: 77.7499 };

function sampleOrder(): DropOrderPersisted {
  return {
    provider: 'haversine_fallback',
    distanceMeters: 14000,
    durationSeconds: 2100,
    polyline: '',
    ordered: [
      {
        id: guestStopId('ride-a'),
        label: 'Asha · Flat 101',
        lat: 12.91,
        lng: 77.69,
        dropIndex: 1,
      },
      {
        id: guestStopId('ride-b'),
        label: 'Bala · Flat 204',
        lat: 12.94,
        lng: 77.72,
        dropIndex: 2,
      },
      {
        id: guestStopId('ride-c'),
        label: 'Chitra · Flat 308',
        lat: 12.96,
        lng: 77.74,
        dropIndex: 3,
      },
    ],
    progress: {
      [guestStopId('ride-a')]: { status: 'pending', updatedAt: 't0' },
      [guestStopId('ride-b')]: { status: 'pending', updatedAt: 't0' },
      [guestStopId('ride-c')]: { status: 'pending', updatedAt: 't0' },
    },
    savedAt: 't0',
  };
}

describe('DropRunPanel Greenfield 3-guest host checklist', () => {
  it('shows host per-stop Maps + Arrived, then Dropped after arrive', () => {
    const onMarkStop = vi.fn();
    const order = sampleOrder();
    const { rerender } = render(
      <DropRunPanel
        dropOrder={order}
        isHost
        myRideId="ride-host"
        rideStatus="started"
        missionOrigin={GREENFIELD}
        hostFinalDest={WHITEFIELD}
        onMarkStop={onMarkStop}
      />,
    );

    expect(screen.getByTestId('cleaner-city-host-drop-count')).toHaveTextContent('3 guest drops');
    expect(screen.getByTestId('cleaner-city-open-maps-drop-1')).toBeInTheDocument();
    expect(screen.getByTestId('cleaner-city-open-maps-drop-2')).toBeInTheDocument();
    expect(screen.getByTestId('cleaner-city-open-maps-drop-3')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('cleaner-city-mark-arrived-1'));
    expect(onMarkStop).toHaveBeenCalledWith(guestStopId('ride-a'), 'arrived');

    const arrived = {
      ...order,
      progress: {
        ...order.progress,
        [guestStopId('ride-a')]: { status: 'arrived' as const, updatedAt: 't1' },
      },
    };
    rerender(
      <DropRunPanel
        dropOrder={arrived}
        isHost
        myRideId="ride-host"
        rideStatus="started"
        missionOrigin={GREENFIELD}
        hostFinalDest={WHITEFIELD}
        onMarkStop={onMarkStop}
      />,
    );
    fireEvent.click(screen.getByTestId('cleaner-city-mark-dropped-1'));
    expect(onMarkStop).toHaveBeenCalledWith(guestStopId('ride-a'), 'dropped');
  });

  it('shows guest Drop N of M and full list', () => {
    render(
      <DropRunPanel
        dropOrder={sampleOrder()}
        isHost={false}
        myRideId="ride-b"
        rideStatus="started"
        missionOrigin={GREENFIELD}
        hostFinalDest={WHITEFIELD}
        onMarkStop={() => {}}
      />,
    );
    expect(screen.getByTestId('cleaner-city-guest-drop-slot')).toHaveTextContent(
      'You are Drop 2 of 3',
    );
    expect(screen.getByTestId('cleaner-city-guest-drop-list')).toBeInTheDocument();
    expect(screen.queryByTestId('cleaner-city-mark-arrived-1')).not.toBeInTheDocument();
  });
});
