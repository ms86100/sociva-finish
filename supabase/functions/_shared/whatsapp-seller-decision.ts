/**
 * Seller order actions on a personal WhatsApp chat.
 * A button id can move one legal next step. A 4-digit code can complete delivery.
 * Any other text, including "accept" or "Perfect", does nothing.
 */

const UUID = "([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})";
const ACCEPT_ID = new RegExp(`^sociva_seller_accept:${UUID}$`, "i");
const REJECT_ID = new RegExp(`^sociva_seller_reject:${UUID}$`, "i");
const STEP_ID = new RegExp(`^sociva_seller_step:${UUID}:([a-z_]{1,32})$`, "i");

export type SellerWaAction =
  | { kind: "accept" | "reject"; orderId: string; buttonId: string }
  | { kind: "step"; orderId: string; status: string; buttonId: string };

export type SellerCardContext = {
  order_id: string;
  order_ref?: string | null;
  status?: string | null;
  buyer_name?: string | null;
  society?: string | null;
  block?: string | null;
  flat?: string | null;
  address?: string | null;
  items?: string | null;
  amount?: number | string | null;
  note?: string | null;
  next_status?: string | null;
  needs_otp?: boolean | null;
  can_reject?: boolean | null;
  terminal?: boolean | null;
};

export type SellerWaButton = { id: string; displayText: string };

export type SellerWaCard = {
  title: string;
  description: string;
  text: string;
  buttons: SellerWaButton[];
};

const STEP_LABEL: Record<string, string> = {
  accepted: "Accept",
  confirmed: "Confirm",
  scheduled: "Schedule",
  preparing: "Start preparing",
  ready: "Mark ready",
  ready_for_pickup: "Ready to pick up",
  picked_up: "Picked up",
  on_the_way: "On the way",
  out_for_delivery: "Out for delivery",
  arrived: "Reached",
  at_gate: "At the gate",
  completed: "Mark done",
};

const STATUS_WORD: Record<string, string> = {
  placed: "New order",
  enquired: "New request",
  requested: "New request",
  quoted: "Quote requested",
  accepted: "Accepted",
  confirmed: "Confirmed",
  scheduled: "Scheduled",
  preparing: "Preparing",
  ready: "Ready",
  ready_for_pickup: "Ready for pickup",
  picked_up: "Picked up",
  on_the_way: "On the way",
  out_for_delivery: "Out for delivery",
  arrived: "At the address",
  at_gate: "At the gate",
  awaiting_cod_confirmation: "Waiting for payment",
  delivered: "Delivered",
  completed: "Completed",
  cancelled: "Cancelled",
};

export function sellerDecisionButtonIds(orderId: string): {
  accept: string;
  reject: string;
} {
  return {
    accept: `sociva_seller_accept:${orderId}`,
    reject: `sociva_seller_reject:${orderId}`,
  };
}

export function sellerStepButtonId(orderId: string, status: string): string {
  return `sociva_seller_step:${orderId}:${status}`;
}

export function sellerStepLabel(status: string): string {
  return (STEP_LABEL[status] || "Update").slice(0, 20);
}

export function parseSellerOrderDecision(
  buttonId: string | null | undefined,
): { orderId: string; decision: "accept" | "reject" } | null {
  const action = parseSellerWhatsAppAction(buttonId);
  if (!action || action.kind === "step") return null;
  return { orderId: action.orderId, decision: action.kind };
}

export function parseSellerWhatsAppAction(
  buttonId: string | null | undefined,
): SellerWaAction | null {
  const raw = String(buttonId || "").trim();
  const accept = raw.match(ACCEPT_ID);
  if (accept) return { kind: "accept", orderId: accept[1], buttonId: raw };
  const reject = raw.match(REJECT_ID);
  if (reject) return { kind: "reject", orderId: reject[1], buttonId: raw };
  const step = raw.match(STEP_ID);
  if (step) {
    return {
      kind: "step",
      orderId: step[1],
      status: step[2].toLowerCase(),
      buttonId: raw,
    };
  }
  return null;
}

/** Delivery codes are exactly 4 digits. Anything else is not an OTP. */
export function isDeliveryCodeMessage(text: string | null | undefined): boolean {
  return /^[0-9]{4}$/.test(String(text || "").trim());
}

function clean(value: string | null | undefined): string {
  return String(value || "")
    .replace(/[\u2013\u2014\u00b7]/g, " - ")
    .replace(/\s+/g, " ")
    .trim();
}

function placeLine(ctx: SellerCardContext): string {
  const blockRaw = clean(ctx.block);
  const block = !blockRaw
    ? ""
    : /tower|block|wing|phase/i.test(blockRaw)
    ? blockRaw
    : `Block ${blockRaw}`;
  const flatRaw = clean(ctx.flat);
  const flat = !flatRaw
    ? ""
    : /flat|door|house/i.test(flatRaw)
    ? flatRaw
    : `Flat ${flatRaw}`;
  return [clean(ctx.society), block, flat].filter(Boolean).join(" - ");
}

function money(amount: SellerCardContext["amount"]): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "";
  const rounded = Math.round(n);
  return `Rs ${rounded}`;
}

/**
 * First card at 1 minute. Then 15 min, 30 min, then hourly, while the same
 * status is still open. Stops after 18 hours on that status.
 */
export function sellerReminderDue(input: {
  statusAgeMs: number;
  lastCardAtMs: number | null;
  priorCards: number;
  nowMs: number;
}): boolean {
  const maxAge = 18 * 60 * 60 * 1000;
  if (input.statusAgeMs < 60_000 || input.statusAgeMs > maxAge) return false;
  if (input.lastCardAtMs == null || input.priorCards <= 0) return true;
  const gapMin = input.priorCards <= 1 ? 15 : input.priorCards === 2 ? 30 : 60;
  return input.nowMs - input.lastCardAtMs >= gapMin * 60_000;
}

export function buildSellerWhatsAppCard(
  ctx: SellerCardContext,
  opts?: { reminder?: boolean },
): SellerWaCard {
  const ref = clean(ctx.order_ref) || String(ctx.order_id || "").slice(-6).toUpperCase();
  const title = `Order #${ref}`;
  const status = String(ctx.status || "");
  const word = STATUS_WORD[status] || "Update";
  const lines: string[] = [];
  const who = clean(ctx.buyer_name);
  if (who) lines.push(who);
  const place = placeLine(ctx);
  if (place) lines.push(place);
  if (!clean(ctx.flat) && clean(ctx.address)) lines.push(clean(ctx.address).slice(0, 80));
  const item = clean(ctx.items);
  const price = money(ctx.amount);
  if (item || price) lines.push([item, price].filter(Boolean).join(" - "));
  const note = clean(ctx.note);
  if (note) lines.push(`Note: ${note.slice(0, 80)}`);

  const next = String(ctx.next_status || "");
  const needsOtp = ctx.needs_otp === true;
  const reminder = opts?.reminder === true;
  if (ctx.terminal) {
    lines.push(`${word}. The buyer can see this.`);
  } else if (needsOtp) {
    lines.push(
      reminder
        ? `${word}. Reply with the 4-digit code the buyer shows you. That marks it delivered.`
        : "Reply with the 4-digit code the buyer shows you. That marks it delivered.",
    );
  } else if (next) {
    const label = sellerStepLabel(next);
    lines.push(
      reminder
        ? `Still ${word.toLowerCase()}. Tap ${label}.`
        : `${word}. Tap ${label}.`,
    );
  } else {
    lines.push(`${word}. Open Sociva if you need another action.`);
  }

  const buttons: SellerWaButton[] = [];
  if (!ctx.terminal && !needsOtp && next) {
    buttons.push({
      id: sellerStepButtonId(ctx.order_id, next),
      displayText: sellerStepLabel(next),
    });
  }
  if (!ctx.terminal && ctx.can_reject === true) {
    buttons.push({
      id: sellerDecisionButtonIds(ctx.order_id).reject,
      displayText: "Reject",
    });
  }

  const description = lines.join("\n");
  return {
    title,
    description,
    text: `${title}\n${description}`,
    buttons: buttons.slice(0, 3),
  };
}
