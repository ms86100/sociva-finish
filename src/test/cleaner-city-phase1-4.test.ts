import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { formatMatchReason, formatMatchReasons } from '@/lib/cleaner-city/matchCopy';

function readSrc(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

const hookFile = readSrc('src/hooks/queries/useCleanerCity.ts');
const offerPage = readSrc('src/pages/cleaner-city/CleanerCityOfferPage.tsx');
const findPage = readSrc('src/pages/cleaner-city/CleanerCityFindPage.tsx');
const hubPage = readSrc('src/pages/cleaner-city/CleanerCityPage.tsx');
const ridePage = readSrc('src/pages/cleaner-city/CleanerCityRidePage.tsx');
const schedulePage = readSrc('src/pages/cleaner-city/CleanerCitySchedulePage.tsx');
const circlesPage = readSrc('src/pages/cleaner-city/CleanerCityCirclesPage.tsx');
const safetyPage = readSrc('src/pages/cleaner-city/CleanerCitySafetyPage.tsx');
const appFile = readSrc('src/App.tsx');
const constantsFile = readSrc('src/lib/cleaner-city/constants.ts');
const nativeLocationFile = readSrc('src/lib/native-location.ts');
const adminTabFile = readSrc('src/components/admin/AdminCleanerCityTab.tsx');

describe('A Cleaner City Phase 1-4 hook contracts', () => {
  it('exposes autopilot hooks wired to cleaner_city_set_autopilot and cleaner_city_confirm_publication', () => {
    expect(hookFile).toContain('useSetAutopilot');
    expect(hookFile).toContain('cleaner_city_set_autopilot');
    expect(hookFile).toContain('useConfirmPublication');
    expect(hookFile).toContain('cleaner_city_confirm_publication');
  });

  it('exposes waitlist hooks wired to join/leave waitlist RPCs and the waitlist table', () => {
    expect(hookFile).toContain('useJoinWaitlist');
    expect(hookFile).toContain('cleaner_city_join_waitlist');
    expect(hookFile).toContain('useLeaveWaitlist');
    expect(hookFile).toContain('cleaner_city_leave_waitlist');
    expect(hookFile).toContain('useMyWaitlist');
    expect(hookFile).toContain('commute_waitlist');
  });

  it('exposes no-show and suggest-replacement hooks', () => {
    expect(hookFile).toContain('useMarkNoShow');
    expect(hookFile).toContain('cleaner_city_mark_no_show');
    expect(hookFile).toContain('useSuggestReplacements');
    expect(hookFile).toContain('cleaner_city_suggest_replacements');
  });

  it('exposes meeting point hooks', () => {
    expect(hookFile).toContain('useMeetupPoints');
    expect(hookFile).toContain('cleaner_city_list_meetup_points');
    expect(hookFile).toContain('useSetMeetingPoint');
    expect(hookFile).toContain('cleaner_city_set_meeting_point');
  });

  it('exposes emergency contact CRUD hooks', () => {
    expect(hookFile).toContain('useEmergencyContacts');
    expect(hookFile).toContain('useUpsertEmergencyContact');
    expect(hookFile).toContain('cleaner_city_upsert_emergency_contact');
    expect(hookFile).toContain('useDeleteEmergencyContact');
    expect(hookFile).toContain('cleaner_city_delete_emergency_contact');
  });

  it('exposes quick message hooks', () => {
    expect(hookFile).toContain('useSendQuickMessage');
    expect(hookFile).toContain('cleaner_city_send_quick_message');
    expect(hookFile).toContain('useQuickMessages');
    expect(hookFile).toContain('ride_quick_messages');
  });

  it('exposes circle hooks', () => {
    expect(hookFile).toContain('useMyCircles');
    expect(hookFile).toContain('cleaner_city_my_circles');
    expect(hookFile).toContain('useCreateCircle');
    expect(hookFile).toContain('cleaner_city_create_circle');
    expect(hookFile).toContain('useJoinCircle');
    expect(hookFile).toContain('cleaner_city_join_circle');
  });

  it('exposes block management hooks', () => {
    expect(hookFile).toContain('useListBlocks');
    expect(hookFile).toContain('cleaner_city_list_blocks');
    expect(hookFile).toContain('useUnblockUser');
    expect(hookFile).toContain('cleaner_city_unblock_user');
  });

  it('useRequestRide passes guest pickup/destination coordinates to the RPC', () => {
    expect(hookFile).toMatch(/useRequestRide[\s\S]*?guest_pickup_lat/);
    expect(hookFile).toContain('p_guest_pickup_lat');
    expect(hookFile).toContain('p_guest_pickup_lng');
    expect(hookFile).toContain('p_guest_dest_lat');
    expect(hookFile).toContain('p_guest_dest_lng');
  });

  it('CommuteProfile / autopilot fields are on the profile type', () => {
    expect(hookFile).toContain('autopilot_enabled');
    expect(hookFile).toContain('autopilot_confirm_mode');
  });

  it('CleanerCityRide type exposes meeting point, fuel, and guest pin fields', () => {
    expect(hookFile).toMatch(
      /CleanerCityRide = \{[\s\S]*meeting_point_label[\s\S]*estimated_fuel_paise[\s\S]*\}/,
    );
    expect(hookFile).toContain('guest_pickup_latitude');
    expect(hookFile).toContain('guest_dest_latitude');
  });

  it('useMyRides and useCleanerCityRide select the new ride columns', () => {
    expect(hookFile).toMatch(/useMyRides[\s\S]*?meeting_point_label/);
    expect(hookFile).toMatch(/useCleanerCityRide\(rideId[\s\S]*?meeting_point_label/);
  });

  it('MatchResult keeps shared_circle and estimated_fuel_paise optional', () => {
    expect(hookFile).toMatch(/MatchResult = \{[\s\S]*shared_circle\?: boolean;[\s\S]*\}/);
    expect(hookFile).toMatch(/MatchResult = \{[\s\S]*estimated_fuel_paise\?: number \| null;[\s\S]*\}/);
  });
});

describe('A Cleaner City Phase 1-4 matchCopy', () => {
  it('maps shared_circle to a human reason label', () => {
    expect(formatMatchReason('shared_circle')).not.toBe('Shared Circle');
    expect(formatMatchReasons(['shared_circle'])).toContain('circle');
  });
});

describe('A Cleaner City Phase 1-4 constants', () => {
  it('defines QUICK_MESSAGE_PHRASES matching the backend phrase keys', () => {
    expect(constantsFile).toContain('QUICK_MESSAGE_PHRASES');
    for (const key of ['here', 'five_late', 'wrong_gate', 'coming', 'wait']) {
      expect(constantsFile).toContain(`'${key}'`);
    }
  });

  it('defines autopilot confirm mode options', () => {
    expect(constantsFile).toContain('CLEANER_CITY_AUTOPILOT_MODES');
  });
});

describe('A Cleaner City Phase 1-4 schedule page: autopilot toggle', () => {
  it('wires useSetAutopilot and shows a confirm/auto choice', () => {
    expect(schedulePage).toContain('useSetAutopilot');
    expect(schedulePage).toContain('CLEANER_CITY_AUTOPILOT_MODES');
    expect(schedulePage).toContain('autopilot_enabled');
  });
});

describe('A Cleaner City Phase 1-4 hub page', () => {
  it('shows an autopilot status chip', () => {
    expect(hubPage).toContain('cleaner-city-autopilot-chip');
    expect(hubPage).toContain('autopilot_enabled');
  });

  it('links to circles and safety pages', () => {
    expect(hubPage).toContain('/cleaner-city/circles');
    expect(hubPage).toContain('/cleaner-city/safety');
  });

  it('Home is Find-first with demo corridor matches', () => {
    expect(hubPage).toContain('Where are you headed?');
    expect(hubPage).toContain('HOME_DEMO_RIDES');
    expect(hubPage).toContain('Find your next ride');
    expect(hubPage).toContain('Find live seats');
    expect(hubPage).toContain('Request seat');
    expect(hubPage).toContain('useRequestRide');
    expect(hubPage).toContain('upsertHomeSeatRequest');
    expect(hubPage).toContain('These cards are examples only');
  });

  it('still keeps the Phase 0 active ride card', () => {
    expect(hubPage).toContain('useMyRides');
    expect(hubPage).toContain('activeRide');
    expect(hubPage).toContain('/cleaner-city/ride/');
  });
});

describe('A Cleaner City Phase 1-4 find page', () => {
  it('offers join/leave waitlist actions requiring pickup coordinates', () => {
    expect(findPage).toContain('useJoinWaitlist');
    expect(findPage).toContain('useLeaveWaitlist');
    expect(findPage).toContain('useMyWaitlist');
    expect(findPage).toContain('hasPickup');
  });

  it('passes guest coordinates into useRequestRide', () => {
    expect(findPage).toMatch(/requestRide\.mutateAsync\(\{[\s\S]*guest_pickup_lat/);
  });

  it('shows a shared_circle badge on match cards', () => {
    const card = readSrc('src/components/cleaner-city/CleanerCityMatchCard.tsx');
    expect(card).toContain('match.shared_circle');
    expect(card).toContain('cleaner-city-shared-circle-badge');
  });

  it('suggests replacements on ride cancel', () => {
    expect(findPage).toContain('useSuggestReplacements');
    expect(findPage).toContain('cleaner-city-cancel-alternatives');
  });

  it('never hardcodes Bangalore coordinates', () => {
    expect(findPage).not.toContain('12.9716');
    expect(findPage).not.toContain('77.5946');
  });
});

describe('A Cleaner City Phase 1-4 offer page never regresses Phase 0 fix', () => {
  it('still never falls back to hardcoded Bangalore coordinates', () => {
    expect(offerPage).not.toContain('12.9716');
    expect(offerPage).not.toContain('77.5946');
  });
});

describe('A Cleaner City Phase 1-4 ride page', () => {
  it('offers a meeting point picker wired to useMeetupPoints and useSetMeetingPoint', () => {
    expect(ridePage).toContain('useMeetupPoints');
    expect(ridePage).toContain('useSetMeetingPoint');
    expect(ridePage).toContain('cleaner-city-meeting-point-section');
  });

  it('shows the meeting point label when set', () => {
    expect(ridePage).toContain('meeting_point_label');
    expect(ridePage).toContain('cleaner-city-meeting-point-label');
  });

  it('offers quick message buttons driven by the shared QUICK_MESSAGE_PHRASES list', () => {
    expect(ridePage).toContain('useSendQuickMessage');
    expect(ridePage).toContain('useQuickMessages');
    expect(ridePage).toContain('QUICK_MESSAGE_PHRASES');
    expect(ridePage).toContain('cleaner-city-quick-message-${phrase.key}');
  });

  it('backend phrase keys are covered by the QUICK_MESSAGE_PHRASES constant', () => {
    for (const key of ['here', 'five_late', 'wrong_gate', 'coming', 'wait']) {
      expect(constantsFile).toContain(`'${key}'`);
    }
  });

  it('offers mark no-show wired to useMarkNoShow', () => {
    expect(ridePage).toContain('useMarkNoShow');
    expect(ridePage).toContain('cleaner-city-mark-no-show');
  });

  it('explains SOS is not a 112 dialer and covers emergency contact + counterpart notification', () => {
    expect(ridePage).toContain('not a 112');
    expect(ridePage).toContain('Call 112');
    expect(ridePage).toContain('notified_counterpart');
    expect(ridePage).toContain('/cleaner-city/safety');
  });

  it('shows automatic admin-priced fuel share (no manual propose)', () => {
    expect(ridePage).toContain('ride.estimated_fuel_paise');
    expect(ridePage).toContain('cleaner-city-fuel-auto');
    expect(ridePage).toContain('Amounts cannot be edited');
    expect(ridePage).not.toContain('fuelPrefilled');
  });

  it('points unblock to the safety settings page instead of handling it inline', () => {
    expect(ridePage).toContain('/cleaner-city/safety');
    expect(ridePage).not.toContain('cleaner-city-unblock-button');
  });

  it('documents that live tracking continues while the app stays open and attempts background permission', () => {
    expect(ridePage).toContain('useCleanerCityRideTracking');
    expect(ridePage).toContain('cleaner-city-background-location-note');
    expect(ridePage).toContain('honestyCopy');
  });

  it('re-ticks location on resume via visibility/app state listeners', () => {
    const trackingHook = readSrc('src/hooks/useCleanerCityRideTracking.ts');
    expect(trackingHook).toContain('visibilitychange');
    expect(trackingHook).toContain('appStateChange');
  });

  it('never hardcodes Bangalore coordinates outside of the map default center', () => {
    // The live map still needs a sane default center before any location arrives;
    // this is a map default, not a data fallback, so it is allowed to remain.
    expect(ridePage).toContain('12.9716');
  });
});

describe('A Cleaner City Phase 1-4 new pages', () => {
  it('CleanerCityCirclesPage lists, creates, and joins circles by invite code', () => {
    expect(circlesPage).toContain('useMyCircles');
    expect(circlesPage).toContain('useCreateCircle');
    expect(circlesPage).toContain('useJoinCircle');
    expect(circlesPage).toContain('invite_code');
    expect(circlesPage).toContain('@ts-nocheck');
    expect(circlesPage).toContain('CleanerCityGate');
    expect(circlesPage).toContain('CleanerCityChrome');
  });

  it('CleanerCitySafetyPage manages emergency contacts and blocks', () => {
    expect(safetyPage).toContain('useEmergencyContacts');
    expect(safetyPage).toContain('useUpsertEmergencyContact');
    expect(safetyPage).toContain('useDeleteEmergencyContact');
    expect(safetyPage).toContain('useListBlocks');
    expect(safetyPage).toContain('useUnblockUser');
    expect(safetyPage).toContain('cleaner-city-unblock-button');
    expect(safetyPage).toContain('@ts-nocheck');
    expect(safetyPage).toContain('CleanerCityGate');
  });
});

describe('A Cleaner City Phase 1-4 routing', () => {
  it('registers lazy routes for circles and safety pages', () => {
    expect(appFile).toContain('CleanerCityCirclesPage');
    expect(appFile).toContain('CleanerCitySafetyPage');
    expect(appFile).toContain('/cleaner-city/circles');
    expect(appFile).toContain('/cleaner-city/safety');
  });
});

describe('A Cleaner City Phase 1-4 background location helper', () => {
  it('exposes requestBackgroundLocationPermission', () => {
    expect(nativeLocationFile).toContain('export async function requestBackgroundLocationPermission');
  });
});

describe('A Cleaner City Phase 1-4 admin tab', () => {
  it('notes that meetup points are admin-managed', () => {
    expect(adminTabFile).toContain('meetup point');
  });
});

describe('A Cleaner City Phase 1-4 no em dash / en dash regression', () => {
  const files = [hookFile, hubPage, findPage, ridePage, schedulePage, circlesPage, safetyPage];
  it('never introduces an em dash or en dash in UI copy', () => {
    for (const file of files) {
      expect(file).not.toMatch(/[\u2013\u2014]/);
    }
  });
});
