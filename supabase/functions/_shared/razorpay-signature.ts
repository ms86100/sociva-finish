const decodeHex = (value: string): Uint8Array | null => {
  if (!/^[0-9a-f]{64}$/i.test(value)) return null;
  return Uint8Array.from(
    value.match(/.{2}/g)!.map((byte) => Number.parseInt(byte, 16)),
  );
};

export async function verifyRazorpayCheckoutSignature(
  orderId: string,
  paymentId: string,
  signature: string,
  keySecret: string,
): Promise<boolean> {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return verifyRazorpaySignature(`${orderId}|${paymentId}`, signature, keySecret);
}

export async function verifyRazorpaySignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  try {
    const supplied = decodeHex(signature);
    if (!supplied) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const expected = new Uint8Array(
      await crypto.subtle.sign('HMAC', key, encoder.encode(body)),
    );
    if (expected.length !== supplied.length) return false;

    let difference = 0;
    for (let index = 0; index < expected.length; index += 1) {
      difference |= expected[index] ^ supplied[index];
    }
    return difference === 0;
  } catch {
    return false;
  }
}
