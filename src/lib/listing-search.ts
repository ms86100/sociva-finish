export function listingMatchesSearchText(
  product: { name?: string | null; seller_name?: string | null; category?: string | null; description?: string | null; brand?: string | null },
  query: string,
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const hay = [product.name, product.seller_name, product.category, product.description, product.brand]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return hay.includes(needle);
}

type HoursListing = {
  id?: string;
  seller_id?: string | null;
  seller_availability_start?: string | null;
  seller_availability_end?: string | null;
  seller_operating_days?: string[] | null;
  seller_is_available?: boolean | null;
  seller_vacation_mode?: boolean | null;
};

/** FTS rows omit store hours. Copy hours from the same seller already on the page. */
export function stampSellerHoursFromInventory<T extends HoursListing>(
  row: T,
  inventory: readonly T[],
): T {
  const own = inventory.find((item) => item.id && item.id === row.id);
  if (own) return own;
  const sibling = inventory.find((item) =>
    !!item.seller_id
    && item.seller_id === row.seller_id
    && (item.seller_availability_start || item.seller_availability_end || item.seller_operating_days),
  );
  if (!sibling) return row;
  return {
    ...row,
    seller_availability_start: sibling.seller_availability_start ?? row.seller_availability_start,
    seller_availability_end: sibling.seller_availability_end ?? row.seller_availability_end,
    seller_operating_days: sibling.seller_operating_days ?? row.seller_operating_days,
    seller_is_available: sibling.seller_is_available ?? row.seller_is_available,
    seller_vacation_mode: sibling.seller_vacation_mode ?? row.seller_vacation_mode,
  };
}
