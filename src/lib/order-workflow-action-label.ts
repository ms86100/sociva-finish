export const BUYER_RECEIVED_CTA = "I've received my order";

const BUYER_RECEIPT_STATUSES = new Set(['buyer_received', 'delivered', 'picked_up']);

export function orderWorkflowActionLabel(input: {
  status: string;
  otpRequired: boolean;
  viewRole: 'buyer' | 'seller';
  displayLabel: string;
  isTerminal: boolean;
  isContactEnquiry?: boolean;
  isEnquiryOrder?: boolean;
  currentStatus?: string;
}): string {
  const {
    status,
    otpRequired,
    viewRole,
    displayLabel,
    isTerminal,
    isContactEnquiry,
    isEnquiryOrder,
    currentStatus,
  } = input;

  if (viewRole === 'buyer' && BUYER_RECEIPT_STATUSES.has(status)) {
    return otpRequired ? `Verify & ${BUYER_RECEIVED_CTA}` : BUYER_RECEIVED_CTA;
  }

  if (otpRequired) return isTerminal ? 'Verify & Complete' : `Verify & ${displayLabel}`;
  if (
    isContactEnquiry
    && (status === 'quoted' || status === 'accepted')
    && viewRole === 'seller'
    && currentStatus === 'enquired'
  ) {
    return 'Accept Enquiry';
  }
  if (isContactEnquiry && status === 'completed' && viewRole === 'seller') return 'Mark Delivered';
  if (status === 'quoted' && viewRole === 'seller') return 'Send Quote';
  if (status === 'accepted' && (isEnquiryOrder || currentStatus === 'quoted') && viewRole === 'buyer') {
    return 'Accept Quote';
  }
  if (isContactEnquiry && isTerminal) return 'Mark Delivered';
  return isTerminal ? 'Complete Order' : `Mark ${displayLabel}`;
}
