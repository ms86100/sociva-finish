import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';
import {
  HARD_TO_ACCOMMODATE,
  FEATURE_MATRIX,
  PERSONAS,
  SEED_OFFER,
  FIND_MATCHES,
  DEFAULT_FIND_SEARCH,
  DEFAULT_OFFER_DRAFT,
} from './data';
import type {
  CommuteMode,
  FindSearch,
  OfferDraft,
  OnboardingStep,
  PerspectiveId,
  ProtoState,
  Ride,
  VehicleKind,
} from './types';

export const STORAGE_KEY = 'sociva-cc-prototype-v2';

type Action =
  | { type: 'hydrate'; state: ProtoState }
  | { type: 'reset' }
  | { type: 'setPerspective'; id: PerspectiveId }
  | { type: 'setMode'; mode: CommuteMode }
  | { type: 'setOnboardingStep'; step: OnboardingStep }
  | { type: 'completeOnboarding'; mode: CommuteMode }
  | { type: 'setSheet'; sheet: string | null }
  | { type: 'setDemoHint'; hint: string }
  | { type: 'toggleWaitlist' }
  | { type: 'patchFindSearch'; patch: Partial<FindSearch> }
  | { type: 'runFindSearch' }
  | { type: 'toggleFindDay'; day: string }
  | { type: 'patchOfferDraft'; patch: Partial<OfferDraft> }
  | { type: 'toggleOfferDay'; day: string }
  | { type: 'addOfferStop' }
  | { type: 'saveOfferDraft' }
  | { type: 'publishOffer' }
  | { type: 'requestSeat'; offerId?: string }
  | { type: 'acceptRequest' }
  | { type: 'declineRequest' }
  | { type: 'cancelRide'; by: PerspectiveId }
  | { type: 'setMeetingPoint'; label: string }
  | { type: 'createOtp' }
  | { type: 'setOtpEntered'; value: string }
  | { type: 'verifyOtp' }
  | { type: 'otpFail' }
  | { type: 'startRide' }
  | { type: 'markDrop'; index: number }
  | { type: 'completeRide' }
  | { type: 'rate'; who: PerspectiveId }
  | { type: 'proposeFuel'; amount: number }
  | { type: 'acceptFuel' }
  | { type: 'dispute' }
  | { type: 'noShow' }
  | { type: 'timeoutRequest' }
  | { type: 'createShare' }
  | { type: 'sendChat'; text: string }
  | { type: 'markNotifsRead' };

function initialState(): ProtoState {
  return {
    onboardingComplete: false,
    onboardingStep: 'welcome',
    preferredMode: 'find',
    perspective: 'priya',
    mode: 'find',
    waitlisted: false,
    sheet: null,
    offers: [{ ...SEED_OFFER }],
    findMatches: FIND_MATCHES.map((o) => ({ ...o })),
    findSearch: { ...DEFAULT_FIND_SEARCH },
    offerDraft: { ...DEFAULT_OFFER_DRAFT, stops: [...DEFAULT_OFFER_DRAFT.stops] },
    ride: null,
    notifications: [
      {
        id: 'n1',
        title: 'Welcome to the Cleaner City preview',
        body: 'Mock data only. Try Find → request → switch to Arjun → accept.',
        read: false,
      },
    ],
    demoHint: 'Start as Priya. Request Arjun’s seat, then switch perspective to accept.',
  };
}

function pushNotif(
  state: ProtoState,
  title: string,
  body: string,
): ProtoState['notifications'] {
  return [
    { id: `n-${Date.now()}`, title, body, read: false },
    ...state.notifications,
  ];
}

function persistState(next: ProtoState) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function reduce(state: ProtoState, action: Action): ProtoState {
  switch (action.type) {
    case 'hydrate':
      return action.state;
    case 'reset':
      return initialState();
    case 'setPerspective':
      return {
        ...state,
        perspective: action.id,
        mode: action.id === 'arjun' ? 'offer' : 'find',
        demoHint:
          action.id === 'arjun'
            ? 'You are Arjun (host). Check Discover → Offer or My Rides for Priya’s request.'
            : 'You are Priya (guest). Use Discover → Find to request a seat.',
      };
    case 'setMode':
      return { ...state, mode: action.mode, preferredMode: action.mode };
    case 'setOnboardingStep':
      return { ...state, onboardingStep: action.step };
    case 'completeOnboarding':
      return {
        ...state,
        onboardingComplete: true,
        onboardingStep: 'done',
        preferredMode: action.mode,
        mode: action.mode,
        demoHint: 'Home is ready. Try Find a seat or Offer a seat.',
      };
    case 'setSheet':
      return { ...state, sheet: action.sheet };
    case 'setDemoHint':
      return { ...state, demoHint: action.hint };
    case 'toggleWaitlist':
      return {
        ...state,
        waitlisted: !state.waitlisted,
        demoHint: !state.waitlisted
          ? 'Waitlist on. You will be notified when a seat appears (mock).'
          : 'Waitlist removed.',
      };
    case 'patchFindSearch':
      return { ...state, findSearch: { ...state.findSearch, ...action.patch } };
    case 'runFindSearch':
      return {
        ...state,
        findSearch: { ...state.findSearch, searched: true },
        demoHint: 'Community rides along your corridor. Request Arjun for the shared demo ride.',
      };
    case 'toggleFindDay': {
      const days = state.findSearch.days.includes(action.day)
        ? state.findSearch.days.filter((d) => d !== action.day)
        : [...state.findSearch.days, action.day];
      return { ...state, findSearch: { ...state.findSearch, days } };
    }
    case 'patchOfferDraft':
      return { ...state, offerDraft: { ...state.offerDraft, ...action.patch } };
    case 'toggleOfferDay': {
      const days = state.offerDraft.days.includes(action.day)
        ? state.offerDraft.days.filter((d) => d !== action.day)
        : [...state.offerDraft.days, action.day];
      return { ...state, offerDraft: { ...state.offerDraft, days } };
    }
    case 'addOfferStop': {
      const label = state.offerDraft.stopInput.trim();
      if (!label) return state;
      return {
        ...state,
        offerDraft: {
          ...state.offerDraft,
          stops: [...state.offerDraft.stops, label],
          stopInput: '',
        },
        demoHint: 'Match pins help riders find your corridor. Drop-run order stays automatic on the live ride.',
      };
    }
    case 'saveOfferDraft':
      return {
        ...state,
        offerDraft: { ...state.offerDraft, saved: true },
        demoHint: 'Draft saved for later. Publish when you are ready to go live.',
        notifications: pushNotif(state, 'Offer draft saved', 'You can publish from Discover → Offer anytime.'),
      };
    case 'publishOffer': {
      if (!PERSONAS.arjun.hasVehicle || !PERSONAS.arjun.emergencyOk) {
        return { ...state, sheet: 'gate-offer', demoHint: 'Add vehicle and emergency contact before publishing.' };
      }
      const d = state.offerDraft;
      const publishedOffer = {
        ...SEED_OFFER,
        published: true,
        seatsOpen: d.seats,
        seatsTotal: Math.max(d.seats, SEED_OFFER.seatsTotal),
        time: d.leaveTime,
        date: d.date,
        fuelEstimate: d.fuelGuide,
        vehicleKind: d.vehicleKind as VehicleKind,
        stops: d.stops.length ? d.stops : SEED_OFFER.stops,
        corridor: `${d.pickup} → ${d.dropoff}`,
      };
      const offers = state.offers.map((o) => (o.id === SEED_OFFER.id ? publishedOffer : o));
      const findMatches = state.findMatches.map((o) =>
        o.id === SEED_OFFER.id ? { ...publishedOffer, bestFit: true, requestable: true } : o,
      );
      return {
        ...state,
        offers,
        findMatches,
        offerDraft: { ...d, saved: false },
        mode: 'offer',
        notifications: pushNotif(state, 'Offer live', `Your seats are published for ${d.date} ${d.leaveTime}.`),
        demoHint: 'Offer published. Switch to Priya to request it.',
      };
    }
    case 'requestSeat': {
      if (state.ride && !['completed', 'declined', 'cancelled', 'timed_out', 'no_show', 'disputed'].includes(state.ride.status)) {
        return { ...state, sheet: 'active-lock', demoHint: 'You already have an active seat for this corridor.' };
      }
      const offerId = action.offerId || SEED_OFFER.id;
      const offer =
        state.findMatches.find((o) => o.id === offerId) ||
        state.offers.find((o) => o.id === offerId) ||
        state.offers[0];
      if (!offer.requestable && offer.hostId !== 'arjun') {
        return {
          ...state,
          demoHint: 'Demo lifecycle uses Arjun’s offer - request the Best route overlap card.',
        };
      }
      const ride: Ride = {
        id: 'ride-demo-1',
        offerId: offer.id,
        guestId: 'priya',
        hostId: 'arjun',
        status: 'requested',
        meetingPoint: null,
        otp: null,
        otpEntered: '',
        chat: [
          {
            id: 'c0',
            from: 'priya',
            text: 'Hi Arjun - requesting a seat toward Manyata.',
            at: 'just now',
          },
        ],
        fuelProposed: null,
        fuelAccepted: false,
        guestRated: false,
        hostRated: false,
        shareToken: null,
        dropStops: [
          { label: 'Manyata Gate 2 (Priya)', done: false },
          { label: 'Wipro Block C (Arjun)', done: false },
        ],
      };
      return {
        ...state,
        ride,
        notifications: pushNotif(state, 'Seat requested', 'Waiting for Arjun to accept.'),
        demoHint: 'Request sent. Switch to Arjun → Discover Offer for the seat-request inbox.',
      };
    }
    case 'acceptRequest': {
      if (!state.ride || state.ride.status !== 'requested') return state;
      const bump = (list: typeof state.offers) =>
        list.map((o) =>
          o.id === state.ride!.offerId ? { ...o, seatsOpen: Math.max(0, o.seatsOpen - 1) } : o,
        );
      return {
        ...state,
        ride: { ...state.ride, status: 'confirmed' },
        offers: bump(state.offers),
        findMatches: bump(state.findMatches),
        notifications: pushNotif(state, 'Ride confirmed', 'Set a meeting point when ready.'),
        demoHint: 'Accepted. Open the ride - both sides share this mission.',
      };
    }
    case 'declineRequest': {
      if (!state.ride) return state;
      return {
        ...state,
        ride: { ...state.ride, status: 'declined' },
        notifications: pushNotif(state, 'Request declined', 'Priya can find another match or join waitlist.'),
        demoHint: 'Declined. Switch to Priya to see the outcome.',
        sheet: 'declined',
      };
    }
    case 'cancelRide': {
      if (!state.ride) return state;
      return {
        ...state,
        ride: { ...state.ride, status: 'cancelled' },
        notifications: pushNotif(state, 'Ride cancelled', `${action.by === 'priya' ? 'Priya' : 'Arjun'} cancelled.`),
        sheet: 'cancelled',
      };
    }
    case 'setMeetingPoint': {
      if (!state.ride) return state;
      return {
        ...state,
        ride: {
          ...state.ride,
          meetingPoint: action.label,
          status: state.ride.status === 'confirmed' ? 'pickup_pending' : state.ride.status,
        },
        demoHint: 'Meeting point set. Guest shows OTP; host enters it.',
      };
    }
    case 'createOtp': {
      if (!state.ride) return state;
      return {
        ...state,
        ride: { ...state.ride, otp: '482916', status: 'pickup_pending' },
        demoHint: 'OTP ready. Switch to Arjun and enter 482916.',
      };
    }
    case 'setOtpEntered': {
      if (!state.ride) return state;
      return { ...state, ride: { ...state.ride, otpEntered: action.value } };
    }
    case 'verifyOtp': {
      if (!state.ride?.otp) return state;
      if (state.ride.otpEntered.trim() !== state.ride.otp) {
        return { ...state, sheet: 'otp-fail', demoHint: 'OTP did not match. Try 482916.' };
      }
      return {
        ...state,
        ride: { ...state.ride, status: 'started' },
        notifications: pushNotif(state, 'Trip started', 'Live journey is on.'),
        demoHint: 'Live ride. Use chat, SOS, share, then Complete.',
        sheet: null,
      };
    }
    case 'otpFail':
      return { ...state, sheet: 'otp-fail' };
    case 'startRide': {
      if (!state.ride?.meetingPoint) {
        return { ...state, sheet: 'need-meeting' };
      }
      return reduce(state, { type: 'verifyOtp' });
    }
    case 'markDrop': {
      if (!state.ride) return state;
      const dropStops = state.ride.dropStops.map((s, i) =>
        i === action.index ? { ...s, done: true } : s,
      );
      return { ...state, ride: { ...state.ride, dropStops } };
    }
    case 'completeRide': {
      if (!state.ride) return state;
      return {
        ...state,
        ride: { ...state.ride, status: 'completed', fuelProposed: 60 },
        notifications: pushNotif(state, 'Ride completed', 'Rate and settle optional fuel share.'),
        demoHint: 'Completed. Rate from either perspective; accept fuel as Priya.',
      };
    }
    case 'rate': {
      if (!state.ride) return state;
      return {
        ...state,
        ride: {
          ...state.ride,
          guestRated: action.who === 'priya' ? true : state.ride.guestRated,
          hostRated: action.who === 'arjun' ? true : state.ride.hostRated,
        },
      };
    }
    case 'proposeFuel': {
      if (!state.ride) return state;
      return { ...state, ride: { ...state.ride, fuelProposed: action.amount } };
    }
    case 'acceptFuel': {
      if (!state.ride) return state;
      return {
        ...state,
        ride: { ...state.ride, fuelAccepted: true },
        notifications: pushNotif(state, 'Fuel share paid', '₹60 marked paid (mock Razorpay).'),
      };
    }
    case 'dispute': {
      if (!state.ride) return state;
      return { ...state, ride: { ...state.ride, status: 'disputed' }, sheet: 'dispute' };
    }
    case 'noShow': {
      if (!state.ride) return state;
      return { ...state, ride: { ...state.ride, status: 'no_show' }, sheet: 'no-show' };
    }
    case 'timeoutRequest': {
      if (!state.ride) return state;
      return { ...state, ride: { ...state.ride, status: 'timed_out' }, sheet: 'timeout' };
    }
    case 'createShare': {
      if (!state.ride) return state;
      return {
        ...state,
        ride: { ...state.ride, shareToken: 'mock-share-greenfield' },
        sheet: 'share',
      };
    }
    case 'sendChat': {
      if (!state.ride) return state;
      const msg = {
        id: `c-${Date.now()}`,
        from: state.perspective,
        text: action.text,
        at: 'now',
      };
      return { ...state, ride: { ...state.ride, chat: [...state.ride.chat, msg] } };
    }
    case 'markNotifsRead':
      return {
        ...state,
        notifications: state.notifications.map((n) => ({ ...n, read: true })),
      };
    default:
      return state;
  }
}

function reducer(state: ProtoState, action: Action): ProtoState {
  const next = reduce(state, action);
  // Sync persist so HashRouter remounts during navigate never reload a stale session.
  if (next !== state) persistState(next);
  return next;
}

interface StoreApi {
  state: ProtoState;
  dispatch: React.Dispatch<Action>;
  me: (typeof PERSONAS)[PerspectiveId];
  other: (typeof PERSONAS)[PerspectiveId];
  matrix: typeof FEATURE_MATRIX;
  hard: typeof HARD_TO_ACCOMMODATE;
  resetDemo: () => void;
}

const Ctx = createContext<StoreApi | null>(null);

function loadState(): ProtoState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ProtoState>;
      if (parsed && typeof parsed.onboardingComplete === 'boolean') {
        const base = initialState();
        return {
          ...base,
          ...parsed,
          findSearch: { ...base.findSearch, ...(parsed.findSearch || {}) },
          offerDraft: {
            ...base.offerDraft,
            ...(parsed.offerDraft || {}),
            stops: parsed.offerDraft?.stops?.length
              ? parsed.offerDraft.stops
              : [...base.offerDraft.stops],
          },
          findMatches: parsed.findMatches?.length
            ? parsed.findMatches
            : base.findMatches,
          offers: parsed.offers?.length ? parsed.offers : base.offers,
        };
      }
    }
  } catch {
    /* ignore */
  }
  return initialState();
}

export function PrototypeProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  const resetDemo = useCallback(() => {
    sessionStorage.removeItem(STORAGE_KEY);
    dispatch({ type: 'reset' });
  }, []);

  const value = useMemo<StoreApi>(() => {
    const me = PERSONAS[state.perspective];
    const other = PERSONAS[state.perspective === 'priya' ? 'arjun' : 'priya'];
    return {
      state,
      dispatch,
      me,
      other,
      matrix: FEATURE_MATRIX,
      hard: HARD_TO_ACCOMMODATE,
      resetDemo,
    };
  }, [state, resetDemo]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useProto() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useProto outside PrototypeProvider');
  return ctx;
}
