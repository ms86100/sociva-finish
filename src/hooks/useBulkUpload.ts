// @ts-nocheck
import { useState, useMemo, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { CategoryConfig } from '@/types/categories';
import { friendlyError } from '@/lib/utils';
import { Subcategory } from '@/hooks/useSubcategories';

export interface BulkRow {
  name: string;
  price: string;
  mrp: string;
  category: string;
  subcategory_id: string;
  description: string;
  is_veg: boolean;
  prep_time_minutes: string;
  action_type: string;
  stock_quantity: string;
  error?: string;
}

const EMPTY_ROW: BulkRow = {
  name: '', price: '', mrp: '', category: '', subcategory_id: '',
  description: '', is_veg: true, prep_time_minutes: '',
  action_type: 'add_to_cart', stock_quantity: '',
};

function getCategoryConfig(slug: string, categories: CategoryConfig[]): CategoryConfig | undefined {
  return categories.find(c => c.category === slug);
}

/** RFC 4180-aware CSV line parser — handles quoted fields with commas and escaped quotes */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

export function useBulkUpload(sellerId: string, allowedCategories: CategoryConfig[], onSuccess: () => void, onClose: () => void) {
  const [rows, setRows] = useState<BulkRow[]>([{ ...EMPTY_ROW, category: allowedCategories[0]?.category || '' }]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: number; errors: number } | null>(null);
  const [showSuccessDialog, setShowSuccessDialog] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);

  // Fetch all subcategories for allowed categories
  useEffect(() => {
    const fetchSubs = async () => {
      const { data } = await supabase
        .from('subcategories')
        .select('*')
        .eq('is_active', true)
        .order('display_order', { ascending: true });
      if (data) setSubcategories(data as Subcategory[]);
    };
    fetchSubs();
  }, []);

  const categorySlugs = useMemo(() => allowedCategories.map(c => c.category), [allowedCategories]);
  const anyShowVeg = useMemo(() => allowedCategories.some(c => c.formHints.showVegToggle), [allowedCategories]);
  const anyShowDuration = useMemo(() => allowedCategories.some(c => c.formHints.showDurationField), [allowedCategories]);
  const hasMultipleCategories = allowedCategories.length > 1;

  // Check if any category has subcategories
  const anyHasSubcategories = useMemo(() => {
    if (subcategories.length === 0) return false;
    return allowedCategories.some(c => {
      const catConfigId = (c as any).id;
      return catConfigId && subcategories.some(s => s.category_config_id === catConfigId);
    });
  }, [allowedCategories, subcategories]);

  const getSubcategoriesForCategory = useCallback((categorySlug: string) => {
    const config = allowedCategories.find(c => c.category === categorySlug);
    if (!config) return [];
    const catConfigId = (config as any).id;
    if (!catConfigId) return [];
    return subcategories.filter(s => s.category_config_id === catConfigId);
  }, [allowedCategories, subcategories]);

  const addRow = useCallback(() => {
    setRows(prev => [...prev, { ...EMPTY_ROW, category: allowedCategories[0]?.category || '' }]);
  }, [allowedCategories]);

  const removeRow = useCallback((index: number) => {
    setRows(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== index));
  }, []);

  const updateRow = useCallback((index: number, field: keyof BulkRow, value: any) => {
    setRows(prev => prev.map((r, i) => {
      if (i !== index) return r;
      const updated = { ...r, [field]: value, error: undefined };
      // Reset subcategory when category changes
      if (field === 'category' && value !== r.category) {
        updated.subcategory_id = '';
      }
      return updated;
    }));
  }, []);

  const generateCSVTemplate = useCallback(() => {
    const headers = 'name,price,mrp,category,subcategory,description,is_veg,prep_time_minutes,action_type,stock_quantity';
    const example = `Paneer Butter Masala,250,300,${allowedCategories[0]?.category || 'home_food'},,Rich creamy paneer dish,true,30,add_to_cart,50`;
    const blob = new Blob([headers + '\n' + example + '\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'product_template.csv'; a.click();
    URL.revokeObjectURL(url);
  }, [allowedCategories]);

  const handleCSVUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const lines = text.split('\n').filter(l => l.trim());
      if (lines.length < 2) { toast.error('CSV must have a header row and at least one data row'); return; }

      const headers = parseCSVLine(lines[0]).map(h => h.trim().toLowerCase());
      const nameIdx = headers.indexOf('name');
      const priceIdx = headers.indexOf('price');
      const mrpIdx = headers.indexOf('mrp');
      const categoryIdx = headers.indexOf('category');
      const subcategoryIdx = headers.indexOf('subcategory');
      const descIdx = headers.indexOf('description');
      const vegIdx = headers.indexOf('is_veg');
      const prepIdx = headers.indexOf('prep_time_minutes');
      const actionIdx = headers.indexOf('action_type');
      const stockIdx = headers.indexOf('stock_quantity');

      if (nameIdx === -1 || priceIdx === -1) { toast.error('CSV must have "name" and "price" columns'); return; }

      const parsed: BulkRow[] = lines.slice(1).map(line => {
        const cols = parseCSVLine(line);
        const cat = cols[categoryIdx] || allowedCategories[0]?.category || '';
        const config = getCategoryConfig(cat, allowedCategories);

        // Resolve subcategory slug to ID
        let subId = '';
        if (subcategoryIdx >= 0 && cols[subcategoryIdx]) {
          const subSlug = cols[subcategoryIdx];
          const matching = subcategories.find(s => s.slug === subSlug || s.display_name.toLowerCase() === subSlug.toLowerCase());
          if (matching) subId = matching.id;
        }

        return {
          name: cols[nameIdx] || '',
          price: cols[priceIdx] || '',
          mrp: mrpIdx >= 0 ? cols[mrpIdx] || '' : '',
          category: cat,
          subcategory_id: subId,
          description: cols[descIdx] || '',
          is_veg: config?.formHints.showVegToggle ? (vegIdx >= 0 ? cols[vegIdx]?.toLowerCase() === 'true' : true) : true,
          prep_time_minutes: config?.formHints.showDurationField ? (prepIdx >= 0 ? cols[prepIdx] || '' : '') : '',
          action_type: actionIdx >= 0 && cols[actionIdx] ? cols[actionIdx] : 'add_to_cart',
          stock_quantity: stockIdx >= 0 ? cols[stockIdx] || '' : '',
        };
      });

      setRows(parsed);
      toast.success(`Parsed ${parsed.length} rows from CSV`);
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [allowedCategories, subcategories]);

  const validate = useCallback((): boolean => {
    let hasErrors = false;
    const validated = rows.map((row, idx) => {
      const errors: string[] = [];
      if (!row.name.trim()) errors.push('Name required');

      const isEnquiry = ['contact_seller', 'request_quote', 'make_offer'].includes(row.action_type);
      const price = parseFloat(row.price);
      if (!isEnquiry && (isNaN(price) || price <= 0)) errors.push('Invalid price');

      if (!row.category) errors.push('Category required');
      else if (!categorySlugs.includes(row.category)) errors.push('Invalid category');

      // MRP validation
      if (row.mrp) {
        const mrp = parseFloat(row.mrp);
        if (isNaN(mrp) || mrp <= 0) errors.push('Invalid MRP');
        else if (!isNaN(price) && mrp < price) errors.push('MRP must be ≥ price');
      }

      // Stock validation
      if (row.stock_quantity) {
        const stock = parseInt(row.stock_quantity);
        if (isNaN(stock) || stock < 0) errors.push('Invalid stock');
      }

      const config = getCategoryConfig(row.category, allowedCategories);
      if (config && !config.formHints.showVegToggle && !row.is_veg) errors.push('Veg toggle not applicable');

      const isDupe = rows.some((other, otherIdx) =>
        otherIdx !== idx && other.name.trim().toLowerCase() === row.name.trim().toLowerCase() && other.category === row.category
      );
      if (isDupe) errors.push('Duplicate');

      if (errors.length > 0) { hasErrors = true; return { ...row, error: errors.join(', ') }; }
      return { ...row, error: undefined };
    });
    setRows(validated);
    return !hasErrors;
  }, [rows, categorySlugs, allowedCategories]);

  const handleSave = useCallback(async () => {
    if (!validate()) { toast.error('Fix validation errors before saving'); return; }

    setIsSaving(true);
    setSaveResult(null);
    try {
      // Fetch attribute block defaults for auto-population
      const { data: blockLibrary } = await supabase
        .from('attribute_block_library')
        .select('*')
        .eq('is_active', true);

      const products = rows.map(row => {
        const config = getCategoryConfig(row.category, allowedCategories);
        const mrp = row.mrp ? parseFloat(row.mrp) : null;
        const price = parseFloat(row.price) || 0;
        const stockQty = row.stock_quantity ? parseInt(row.stock_quantity) : null;

        // Auto-populate specifications from block library
        let specifications: any = null;
        if (blockLibrary && blockLibrary.length > 0) {
          const categoryBlocks = blockLibrary.filter(b =>
            b.category_hints && (b.category_hints as string[]).includes(row.category)
          );
          if (categoryBlocks.length > 0) {
            specifications = {
              blocks: categoryBlocks.map(b => ({
                type: b.block_type,
                label: b.display_name,
                fields: {},
              })),
            };
          }
        }

        // Calculate discount percentage if MRP > price
        let discountPct: number | null = null;
        if (mrp && mrp > price && price > 0) {
          discountPct = Math.round(((mrp - price) / mrp) * 100);
        }

        return {
          seller_id: sellerId,
          name: row.name.trim(),
          price,
          mrp,
          discount_percentage: discountPct,
          category: row.category,
          subcategory_id: row.subcategory_id || null,
          description: row.description.trim() || null,
          is_veg: config?.formHints.showVegToggle ? row.is_veg : true,
          prep_time_minutes: config?.formHints.showDurationField && row.prep_time_minutes ? parseInt(row.prep_time_minutes) : null,
          action_type: row.action_type || 'add_to_cart',
          stock_quantity: (stockQty !== null && !isNaN(stockQty) && stockQty >= 0) ? stockQty : null,
          low_stock_threshold: 5,
          is_available: true,
          approval_status: 'draft',
          is_bestseller: false,
          is_recommended: false,
          is_urgent: false,
          accepts_preorders: false,
          specifications,
        };
      });

      const { error } = await supabase.from('products').insert(products as any);
      if (error) throw error;

      setSaveResult({ success: products.length, errors: 0 });
      setSavedCount(products.length);
      toast.success(`${products.length} products added as drafts`);
      onSuccess();
      setShowSuccessDialog(true);
    } catch (error: any) {
      console.error('Bulk save error:', error);
      toast.error(friendlyError(error));
      setSaveResult({ success: 0, errors: rows.length });
    } finally {
      setIsSaving(false);
    }
  }, [rows, validate, sellerId, allowedCategories, onSuccess, onClose]);

  const getRowConfig = useCallback((slug: string) => getCategoryConfig(slug, allowedCategories), [allowedCategories]);

  const dismissSuccessDialog = useCallback(() => {
    setShowSuccessDialog(false);
    setRows([{ ...EMPTY_ROW, category: allowedCategories[0]?.category || '' }]);
    setSaveResult(null);
    onClose();
  }, [allowedCategories, onClose]);

  return {
    rows, isSaving, saveResult, anyShowVeg, anyShowDuration,
    anyHasSubcategories, hasMultipleCategories,
    showSuccessDialog, savedCount, dismissSuccessDialog,
    addRow, removeRow, updateRow, generateCSVTemplate, handleCSVUpload,
    handleSave, getRowConfig, allowedCategories, getSubcategoriesForCategory,
  };
}
