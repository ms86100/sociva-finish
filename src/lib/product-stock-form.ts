export interface StockFormSlice {
  tracks_stock: boolean;
  stock_quantity: string;
  tracks_low_stock_alert: boolean;
  low_stock_threshold: string;
}

export interface ResolvedStockValues {
  stockQty: number | null;
  lowStockThreshold: number | null;
  errors: Record<string, string>;
}

/** Parse stock fields for save — toggles stay on; empty values become validation errors. */
export function resolveStockSaveValues(form: StockFormSlice): ResolvedStockValues {
  const errors: Record<string, string> = {};
  let stockQty: number | null = null;
  let lowStockThreshold: number | null = null;

  if (form.tracks_stock) {
    const raw = form.stock_quantity.trim();
    if (raw === '') {
      errors.stock_quantity = 'Please enter a stock quantity.';
    } else {
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed) || parsed < 0) {
        errors.stock_quantity = 'Please enter a valid stock quantity (0 or higher).';
      } else {
        stockQty = parsed;
      }
    }
  }

  if (form.tracks_stock && form.tracks_low_stock_alert) {
    const raw = form.low_stock_threshold.trim();
    if (raw === '') {
      errors.low_stock_threshold = 'Please enter a low stock alert level.';
    } else {
      const parsed = parseInt(raw, 10);
      if (Number.isNaN(parsed) || parsed < 1) {
        errors.low_stock_threshold = 'Low stock alert must be at least 1.';
      } else if (stockQty !== null && parsed >= stockQty) {
        errors.low_stock_threshold = 'Low stock alert must be less than current stock.';
      } else {
        lowStockThreshold = parsed;
      }
    }
  }

  return { stockQty, lowStockThreshold, errors };
}
