/**
 * Shared resident-facing microcopy used across modules.
 * Domain-specific strings stay in seller-onboarding-copy, rideMissionCopy, etc.
 * See docs/ux-content-audit/04-approved-content-glossary.md
 */

export const UX_COPY = {
  signIn: 'Sign In',
  pleaseSignIn: 'Please Sign In',
  continue: 'Continue',
  tryAgain: 'Try again',
  emptyGeneric: 'Nothing here yet',
  errorGeneric: 'Something went wrong. Please try again.',
  errorNetwork: 'Connection problem. Check your network and try again.',
  successSaved: 'Saved',
  successSent: 'Sent',
  personalDetails: 'Personal Details',
  contactDetails: 'Contact Details',
  paymentHistory: 'Payment History',
  orderStatus: 'Order status',
  addProduct: 'Add Product',
  bookNow: 'Book Now',
  sendRequest: 'Send Request',
  cleanerCityName: 'A Cleaner City',
  fuelContribution: 'Fuel contribution',
  fuelContributionHelp:
    'Your share is calculated from route distance and the current petrol price. This is not a fare.',
  pickupCode: 'Pickup code',
  emptyRides: 'No rides yet. Find a match or offer a seat.',
} as const;
