/** Store-level packaging fee — once per seller in a multi-vendor cart. */

export function resolveSellerPackagingFee(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * 100) / 100;
}

export function totalPackagingFees(
  sellers: Array<{ packaging_fee?: unknown } | null | undefined>,
): number {
  const seen = new Set<number | string>();
  let total = 0;
  sellers.forEach((seller, index) => {
    const key = (seller as any)?.id ?? index;
    if (seen.has(key)) return;
    seen.add(key);
    total += resolveSellerPackagingFee(seller?.packaging_fee);
  });
  return Math.round(total * 100) / 100;
}
