import type { Product } from '@/types/Database';
import type { SelectedExtra } from '@/lib/productExtras';

type Listener = () => void;

export interface VariantPickerRequest {
  product: Product;
  /** Add-ons the buyer already chose on the detail sheet; applied to whichever size they add. */
  extras: SelectedExtra[];
}

let current: VariantPickerRequest | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

/** Ask the mounted size picker to open for a product that is sold by size. */
export function openVariantPicker(product: Product, extras: SelectedExtra[] = []): void {
  current = { product, extras };
  emit();
}

export function closeVariantPicker(): void {
  if (!current) return;
  current = null;
  emit();
}

export function getVariantPickerRequest(): VariantPickerRequest | null {
  return current;
}

export function getVariantPickerProduct(): Product | null {
  return current?.product ?? null;
}

export function subscribeVariantPicker(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
