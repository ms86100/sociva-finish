/** In-society row: same society only. Sell-beyond stores stay in nearby bands. */
export function sellersInOwnSociety<T extends { society_name?: string | null }>(
  sellers: T[],
  societyName?: string | null,
): T[] {
  if (!societyName) return sellers;
  return sellers.filter((seller) => seller.society_name === societyName);
}
