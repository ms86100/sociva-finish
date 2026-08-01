// @ts-nocheck
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, X } from 'lucide-react';
import { useState } from 'react';

interface FieldDef {
  key: string;
  label: string;
  type: string; // text, number, select, tag_input, boolean, textarea, date, variant_rows, size_table
  options?: string[];
  placeholder?: string;
}

interface AttributeBlockFormProps {
  blockType: string;
  schema: Record<string, any>;
  value: Record<string, any>;
  onChange: (value: Record<string, any>) => void;
}

export function AttributeBlockForm({ blockType, schema, value, onChange }: AttributeBlockFormProps) {
  const fields: FieldDef[] = schema?.fields || [];

  if (fields.length === 0) {
    return <p className="text-xs text-muted-foreground italic">No fields configured for this block.</p>;
  }

  return (
    <div className="space-y-3">
      {fields.map((field) => (
        <FieldRenderer
          key={field.key}
          field={field}
          value={value[field.key]}
          onChange={(v) => onChange({ ...value, [field.key]: v })}
        />
      ))}
    </div>
  );
}

function FieldRenderer({ field, value, onChange }: {
  field: FieldDef;
  value: any;
  onChange: (v: any) => void;
}) {
  switch (field.type) {
    case 'text':
      return (
        <div className="space-y-1">
          <Label className="text-xs">{field.label}</Label>
          <Input
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case 'textarea':
      return (
        <div className="space-y-1">
          <Label className="text-xs">{field.label}</Label>
          <Textarea
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            rows={2}
          />
        </div>
      );

    case 'number':
      return (
        <div className="space-y-1">
          <Label className="text-xs">{field.label}</Label>
          <Input
            type="number"
            placeholder={field.placeholder || '0'}
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
          />
        </div>
      );

    case 'boolean':
      return (
        <div className="flex items-center justify-between py-1">
          <Label className="text-xs">{field.label}</Label>
          <Switch checked={!!value} onCheckedChange={onChange} />
        </div>
      );

    case 'select':
      return (
        <div className="space-y-1">
          <Label className="text-xs">{field.label}</Label>
          <Select value={value || ''} onValueChange={onChange}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue placeholder={`Select ${field.label.toLowerCase()}...`} />
            </SelectTrigger>
            <SelectContent>
              {(field.options || []).map((opt) => (
                <SelectItem key={opt} value={opt} className="text-xs">{opt}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      );

    case 'date':
      return (
        <div className="space-y-1">
          <Label className="text-xs">{field.label}</Label>
          <Input
            type="date"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    case 'tag_input':
      return <TagInputField label={field.label} value={value || []} onChange={onChange} />;

    case 'variant_rows':
      return <VariantRowsField value={value || []} onChange={onChange} />;

    case 'size_table':
      return <SizeTableField value={value || []} onChange={onChange} />;

    default:
      return (
        <div className="space-y-1">
          <Label className="text-xs">{field.label}</Label>
          <Input
            placeholder={field.placeholder || `Enter ${field.label.toLowerCase()}...`}
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
  }
}

function TagInputField({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !value.includes(trimmed)) {
      onChange([...value, trimmed]);
      setInput('');
    }
  };

  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className="flex gap-1.5 flex-wrap mb-1">
        {value.map((item, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-xs bg-primary/10 text-primary rounded-full px-2 py-0.5">
            {item}
            <button onClick={() => onChange(value.filter((_, idx) => idx !== i))} className="hover:text-destructive">
              <X size={10} />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          className="h-8 text-xs"
          placeholder={`Add ${label.toLowerCase()}...`}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
        />
        <Button type="button" size="sm" variant="outline" className="h-8 px-2" onClick={add}>
          <Plus size={12} />
        </Button>
      </div>
    </div>
  );
}

function VariantRowsField({ value, onChange }: { value: any[]; onChange: (v: any[]) => void }) {
  const addRow = () => onChange([...value, { label: '', values: [] }]);
  const updateRow = (idx: number, key: string, val: any) => {
    const updated = [...value];
    updated[idx] = { ...updated[idx], [key]: val };
    onChange(updated);
  };
  const removeRow = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      <Label className="text-xs">Variant Options</Label>
      {value.map((row, idx) => (
        <div key={idx} className="space-y-1 border border-border rounded p-2">
          <div className="flex gap-1.5 items-center">
            <Input
              className="h-7 text-xs flex-1"
              placeholder="Label (e.g. Color, Size)"
              value={row.label || ''}
              onChange={(e) => updateRow(idx, 'label', e.target.value)}
            />
            <button onClick={() => removeRow(idx)} className="text-muted-foreground hover:text-destructive">
              <X size={14} />
            </button>
          </div>
          <TagInputField
            label="Values"
            value={row.values || []}
            onChange={(v) => updateRow(idx, 'values', v)}
          />
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addRow}>
        <Plus size={12} className="mr-1" /> Add Variant
      </Button>
    </div>
  );
}

function SizeTableField({ value, onChange }: { value: any[]; onChange: (v: any[]) => void }) {
  const defaultKeys = ['size', 'chest', 'waist', 'length'];

  const addRow = () => {
    const empty: Record<string, string> = {};
    defaultKeys.forEach(k => { empty[k] = ''; });
    onChange([...value, empty]);
  };

  const updateCell = (rowIdx: number, key: string, val: string) => {
    const updated = [...value];
    updated[rowIdx] = { ...updated[rowIdx], [key]: val };
    onChange(updated);
  };

  const removeRow = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const keys = value.length > 0 ? Object.keys(value[0]) : defaultKeys;

  return (
    <div className="space-y-2">
      <Label className="text-xs">Size Chart</Label>
      {value.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {keys.map(k => (
                  <th key={k} className="py-1 px-1 text-left font-semibold text-muted-foreground uppercase text-[10px]">{k}</th>
                ))}
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {value.map((row, idx) => (
                <tr key={idx} className="border-b border-border/50">
                  {keys.map(k => (
                    <td key={k} className="py-0.5 px-1">
                      <Input
                        className="h-6 text-[11px] px-1"
                        value={row[k] || ''}
                        onChange={(e) => updateCell(idx, k, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    <button onClick={() => removeRow(idx)} className="text-muted-foreground hover:text-destructive">
                      <X size={12} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={addRow}>
        <Plus size={12} className="mr-1" /> Add Row
      </Button>
    </div>
  );
}
