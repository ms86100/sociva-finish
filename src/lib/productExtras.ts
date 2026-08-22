export type ExtraInput = 'single' | 'multi' | 'text' | 'boolean' | 'date';

export interface ExtraChoiceGroup {
  id: string;
  blockType: string;
  blockLabel: string;
  fieldKey: string;
  fieldLabel: string;
  input: ExtraInput;
  options: string[];
  required: boolean;
}

export interface SelectedExtra {
  id: string;
  blockType: string;
  blockLabel: string;
  fieldKey: string;
  fieldLabel: string;
  value: string | string[] | boolean;
}

type LibraryBlock = {
  block_type?: string;
  display_name?: string;
  buyer_selectable?: boolean;
  schema?: { fields?: Array<{ key: string; label: string; type: string; options?: string[] }> };
};

type SpecBlock = {
  type?: string;
  data?: Record<string, any>;
};

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function isChoiceField(type: string): boolean {
  return type === 'select' || type === 'tag_input' || type === 'boolean' || type === 'text' || type === 'textarea' || type === 'number' || type === 'date';
}

export function extractBuyerOptionGroups(
  specifications: Record<string, any> | null | undefined,
  library: LibraryBlock[] = [],
): ExtraChoiceGroup[] {
  const blocks = Array.isArray(specifications?.blocks) ? (specifications.blocks as SpecBlock[]) : [];
  if (blocks.length === 0) return [];

  const groups: ExtraChoiceGroup[] = [];

  for (const block of blocks) {
    const type = String(block?.type || '');
    if (!type) continue;
    const data = block.data || {};
    const lib = library.find((item) => item.block_type === type);
    const blockLabel = lib?.display_name || type.replace(/_/g, ' ');
    const buyerSelectable = lib?.buyer_selectable === true;

    if (type === 'variants' && Array.isArray(data.options)) {
      data.options.forEach((opt: any, index: number) => {
        const values = asStringArray(opt?.values);
        if (!opt?.label || values.length === 0) return;
        groups.push({
          id: `${type}:variant:${index}:${opt.label}`,
          blockType: type,
          blockLabel,
          fieldKey: String(opt.label),
          fieldLabel: String(opt.label),
          input: 'single',
          options: values,
          required: true,
        });
      });
      continue;
    }

    const fields = lib?.schema?.fields || [];
    for (const field of fields) {
      if (!field?.key || !isChoiceField(field.type)) continue;
      const raw = data[field.key];
      const sellerChoices = asStringArray(raw);
      const schemaChoices = asStringArray(field.options);
      const options = field.type === 'select'
        ? (schemaChoices.length > 0 ? schemaChoices : sellerChoices)
        : sellerChoices;

      if (!buyerSelectable) continue;

      let input: ExtraInput = 'single';
      if (field.type === 'tag_input') input = 'multi';
      else if (field.type === 'boolean') input = 'boolean';
      else if (field.type === 'date') input = 'date';
      else if (field.type === 'text' || field.type === 'textarea' || field.type === 'number') input = 'text';

      if ((input === 'single' || input === 'multi') && options.length === 0) continue;

      groups.push({
        id: `${type}:${field.key}`,
        blockType: type,
        blockLabel,
        fieldKey: field.key,
        fieldLabel: field.label || field.key,
        input,
        options,
        required: input !== 'text' && input !== 'boolean' && input !== 'multi',
      });
    }
  }

  return groups;
}

export function extrasHaveRequiredGaps(
  groups: ExtraChoiceGroup[],
  selected: SelectedExtra[],
): boolean {
  return groups.some((group) => {
    if (!group.required) return false;
    const match = selected.find((item) => item.id === group.id);
    if (!match) return true;
    if (Array.isArray(match.value)) return match.value.length === 0;
    if (typeof match.value === 'boolean') return false;
    return !String(match.value || '').trim();
  });
}

export function formatSelectedExtras(selected: SelectedExtra[] | null | undefined): string {
  if (!Array.isArray(selected) || selected.length === 0) return '';
  return selected
    .map((item) => {
      const value = Array.isArray(item.value)
        ? item.value.join(', ')
        : typeof item.value === 'boolean'
          ? (item.value ? 'Yes' : 'No')
          : String(item.value || '').trim();
      if (!value) return '';
      return `${item.fieldLabel}: ${value}`;
    })
    .filter(Boolean)
    .join('\n');
}

export function sanitizeSelectedExtras(
  selected: SelectedExtra[] | null | undefined,
  groups: ExtraChoiceGroup[],
): SelectedExtra[] {
  if (!Array.isArray(selected) || selected.length === 0) return [];
  const allowed = new Map(groups.map((group) => [group.id, group]));
  return selected.flatMap((item) => {
    const group = allowed.get(item.id);
    if (!group) return [];
    if (group.input === 'multi') {
      const values = asStringArray(item.value).filter((value) => group.options.includes(value));
      return values.length ? [{ ...item, value: values }] : [];
    }
    if (group.input === 'single') {
      const value = Array.isArray(item.value) ? item.value[0] : String(item.value || '');
      return group.options.includes(value) ? [{ ...item, value }] : [];
    }
    if (group.input === 'boolean') {
      return [{ ...item, value: item.value === true }];
    }
    if (group.input === 'date') {
      const value = String(Array.isArray(item.value) ? item.value[0] : item.value || '').trim();
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? [{ ...item, value }] : [];
    }
    const text = String(Array.isArray(item.value) ? item.value.join(' ') : item.value || '').trim().slice(0, 300);
    return text ? [{ ...item, value: text }] : [];
  });
}

export function extrasFromCartItems(
  items: Array<{ product?: { name?: string | null } | null; selected_extras?: SelectedExtra[] | null }>,
): string {
  return items
    .map((item) => {
      const extras = formatSelectedExtras(item.selected_extras);
      if (!extras) return '';
      const name = item.product?.name || 'Item';
      return `${name}\n${extras}`;
    })
    .filter(Boolean)
    .join('\n\n');
}
