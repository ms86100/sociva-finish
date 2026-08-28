/** Seller-facing copy for prep time vs order lead time (display/UX only — not order SLAs). */

export const PREP_TIME_LABEL = 'Estimated prep time (minutes)';

export const PREP_TIME_HELP =
  'Shown to buyers as an estimate after you accept the order. Sociva does not auto-cancel or enforce this — you manage fulfillment yourself.';

export const LEAD_TIME_LABEL = 'Pre-order lead time';

export const LEAD_TIME_HELP =
  'Only used when Accept Pre-Orders is on. Buyers must schedule delivery at least this far in advance. Does not affect instant orders.';

export const PREORDERS_TOGGLE_LABEL = 'Accept pre-orders only';

export const PREORDERS_TOGGLE_HELP =
  'When on, buyers must pick a future date/time at checkout (using lead time above). When off, lead time is ignored and orders can be instant.';

export const PREP_TIME_PLACEHOLDER = 'e.g. 30';
