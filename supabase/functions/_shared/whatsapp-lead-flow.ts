/**
 * Interactive WhatsApp lead invite replies (Evolution Go button taps).
 * Informational marketing only - never mutates orders.
 */

export const LEAD_BUTTON = {
  KNOW_MORE: "sociva_lead_know_more",
  ALREADY_USER: "sociva_lead_already_user",
  SELL_NEARBY: "sociva_lead_sell_nearby",
} as const;

export const LEAD_INVITE = {
  title: "Join Sociva",
  description:
    "Neighbours in your society already order homemade food, everyday essentials, and local help on Sociva.\n\nTap an option below:",
  footer: "Sociva",
  buttons: [
    { id: LEAD_BUTTON.KNOW_MORE, displayText: "I want to know more" },
    { id: LEAD_BUTTON.ALREADY_USER, displayText: "I am already on Sociva" },
    { id: LEAD_BUTTON.SELL_NEARBY, displayText: "I want to sell nearby" },
  ],
};

const REPLIES: Record<string, string> = {
  [LEAD_BUTTON.KNOW_MORE]:
    "Great choice.\n\n" +
    "Sociva is your society marketplace - order from home kitchens and local stores nearby, or open your own store in minutes.\n\n" +
    "Download and join with your society:\nhttps://sociva.in\n\n" +
    "Need help picking a society? Just reply here with your society name.",
  [LEAD_BUTTON.ALREADY_USER]:
    "Awesome - welcome back.\n\n" +
    "Open Sociva, confirm your society, and you are set:\nhttps://sociva.in\n\n" +
    "If login is stuck, reply with the phone number you used on Sociva and we will help.",
  [LEAD_BUTTON.SELL_NEARBY]:
    "Perfect.\n\n" +
    "On Sociva you can list homemade food or a small store and get orders from people who already live next door - no big delivery marketplace cut.\n\n" +
    "Start seller onboarding:\nhttps://sociva.in\n\n" +
    "Reply with your society name if you want a quick nudge on how to go live.",
};

/**
 * Only an exact invite button id may trigger a reply.
 * Never match free text. Words like "sell" or "store" in group chats
 * were sending the "Perfect." seller reply into those groups.
 */
export function resolveLeadButtonReply(input: {
  buttonId?: string | null;
}): { buttonId: string; replyText: string } | null {
  const id = String(input.buttonId || "").trim();
  if (id && REPLIES[id]) {
    return { buttonId: id, replyText: REPLIES[id] };
  }
  return null;
}

/** Groups, broadcasts, and newsletters must never receive lead auto-replies. */
export function isGroupOrBroadcastChat(payload: any): boolean {
  const info = payload?.data?.Info || payload?.data?.info || {};
  if (info.IsGroup === true || info.isGroup === true) return true;
  if (info.IsNewsletterStatus === true) return true;
  const chats = [
    info.Chat,
    info.chat,
    info.Sender,
    payload?.data?.chat,
    payload?.data?.jid,
    payload?.data?.key?.remoteJid,
    payload?.data?.from,
    payload?.from,
  ];
  return chats.some((value) => /@g\.us|@broadcast|@newsletter/i.test(String(value || "")));
}

/** Personal chat only. Group ids are long numeric strings and must be rejected. */
export function isPersonalWhatsAppDestination(dest: string): boolean {
  const raw = String(dest || "").trim();
  if (!raw) return false;
  if (/@g\.us|@broadcast|@newsletter/i.test(raw)) return false;
  if (/@(s\.whatsapp\.net|lid|c\.us)$/i.test(raw)) return true;
  if (/@/.test(raw)) return false;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 13;
}

/** Pull button id / label from Evolution / whatsmeow-shaped payloads. */
export function extractLeadButtonTap(payload: any): {
  buttonId: string | null;
  displayText: string | null;
  chatJid: string | null;
  isFromMe: boolean;
} {
  const msg =
    payload?.data?.Message ||
    payload?.data?.message ||
    payload?.Message ||
    payload?.message ||
    {};

  const buttonReply =
    msg?.buttonsResponseMessage ||
    msg?.ButtonsResponseMessage ||
    msg?.templateButtonReplyMessage ||
    msg?.TemplateButtonReplyMessage ||
    msg?.listResponseMessage ||
    msg?.ListResponseMessage ||
    payload?.data?.buttonsResponseMessage ||
    payload?.data?.Button ||
    payload?.data?.button ||
    null;

  const buttonId = String(
    buttonReply?.selectedButtonID ||
      buttonReply?.selectedButtonId ||
      buttonReply?.SelectedButtonID ||
      buttonReply?.buttonId ||
      buttonReply?.buttonID ||
      buttonReply?.id ||
      buttonReply?.singleSelectReply?.selectedRowID ||
      payload?.data?.selectedButtonID ||
      payload?.data?.SelectedButtonID ||
      payload?.data?.buttonId ||
      payload?.data?.buttonID ||
      payload?.selectedButtonID ||
      "",
  ).trim() || null;

  const displayText = String(
    buttonReply?.selectedDisplayText ||
      buttonReply?.SelectedDisplayText ||
      buttonReply?.displayText ||
      buttonReply?.buttonText?.displayText ||
      buttonReply?.title ||
      payload?.data?.buttonText ||
      payload?.data?.displayText ||
      payload?.data?.selectedDisplayText ||
      payload?.data?.extraData?.buttonText ||
      "",
  ).trim() || null;

  const chatJid = String(
    payload?.data?.Info?.Chat ||
      payload?.data?.Info?.Sender ||
      payload?.data?.chat ||
      payload?.data?.jid ||
      payload?.data?.key?.remoteJid ||
      payload?.data?.from ||
      "",
  ).trim() || null;

  const isFromMe = Boolean(
    payload?.data?.Info?.IsFromMe === true ||
      payload?.data?.key?.fromMe === true ||
      payload?.data?.fromMe === true ||
      payload?.fromMe === true,
  );

  return { buttonId, displayText, chatJid, isFromMe };
}
