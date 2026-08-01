// @ts-nocheck
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Upload, Download, Plus, Trash2, Loader2, AlertTriangle, CheckCircle2, Info, ImagePlus, Settings, Send } from 'lucide-react';
import { DynamicIcon } from '@/components/ui/DynamicIcon';
import { CategoryConfig } from '@/types/categories';
import { useBulkUpload } from '@/hooks/useBulkUpload';

interface BulkProductUploadProps {
  isOpen: boolean;
  onClose: () => void;
  sellerId: string;
  allowedCategories: CategoryConfig[];
  onSuccess: () => void;
}

const ACTION_TYPE_OPTIONS = [
  { value: 'add_to_cart', label: 'Add to Cart' },
  { value: 'buy_now', label: 'Buy Now' },
  { value: 'book', label: 'Book Now' },
  { value: 'contact_seller', label: 'Contact Seller' },
  { value: 'request_service', label: 'Request Service' },
  { value: 'request_quote', label: 'Request Quote' },
];

export function BulkProductUpload({ isOpen, onClose, sellerId, allowedCategories, onSuccess }: BulkProductUploadProps) {
  const b = useBulkUpload(sellerId, allowedCategories, onSuccess, onClose);

  return (
    <>
    <Drawer open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader><DrawerTitle>Bulk Add Products</DrawerTitle></DrawerHeader>

        <Tabs defaultValue="grid" className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="grid" className="flex-1">Multi-Row Grid</TabsTrigger>
            <TabsTrigger value="csv" className="flex-1">CSV Upload</TabsTrigger>
          </TabsList>

          <TabsContent value="csv" className="space-y-4 mt-4">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={b.generateCSVTemplate}><Download size={14} className="mr-1" />Download Template</Button>
              <Label htmlFor="csv-upload" className="cursor-pointer">
                <Button variant="outline" size="sm" asChild><span><Upload size={14} className="mr-1" />Upload CSV</span></Button>
              </Label>
              <input id="csv-upload" type="file" accept=".csv" className="hidden" onChange={b.handleCSVUpload} />
            </div>
            <p className="text-xs text-muted-foreground">CSV columns: name*, price*, mrp, category, subcategory, description, is_veg, prep_time_minutes, action_type, stock_quantity</p>
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-warning/10 border border-warning/20">
              <Info size={14} className="text-warning shrink-0 mt-0.5" />
              <p className="text-xs text-warning">Images must be added individually after upload. Products without images get fewer views.</p>
            </div>
          </TabsContent>

          <TabsContent value="grid" className="mt-4">
            <div className="flex justify-end mb-2">
              <Button variant="outline" size="sm" onClick={b.addRow}><Plus size={14} className="mr-1" />Add Row</Button>
            </div>
          </TabsContent>
        </Tabs>

        <ScrollArea className="h-[calc(85vh-240px)] mt-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8 sticky left-0 bg-background z-10">#</TableHead>
                  <TableHead className="min-w-[140px]">Name *</TableHead>
                  <TableHead className="w-24">Price *</TableHead>
                  <TableHead className="w-24">MRP</TableHead>
                  {b.hasMultipleCategories && <TableHead className="w-32">Category</TableHead>}
                  {b.anyHasSubcategories && <TableHead className="w-32">Subcategory</TableHead>}
                  <TableHead className="w-32">Action Type</TableHead>
                  <TableHead className="min-w-[120px]">Description</TableHead>
                  {b.anyShowVeg && <TableHead className="w-16">Veg</TableHead>}
                  {b.anyShowDuration && <TableHead className="w-24">Duration</TableHead>}
                  <TableHead className="w-24">Stock</TableHead>
                  <TableHead className="w-8"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {b.rows.map((row, idx) => {
                  const rowConfig = b.getRowConfig(row.category);
                  const rowShowVeg = rowConfig?.formHints.showVegToggle ?? false;
                  const rowShowDuration = rowConfig?.formHints.showDurationField ?? false;
                  const rowSubs = b.getSubcategoriesForCategory(row.category);
                  const isEnquiry = ['contact_seller', 'request_quote', 'make_offer'].includes(row.action_type);

                  return (
                    <TableRow key={idx} className={row.error ? 'bg-destructive/5' : ''}>
                      <TableCell className="text-xs text-muted-foreground sticky left-0 bg-background z-10">{idx + 1}</TableCell>
                      <TableCell>
                        <Input value={row.name} onChange={(e) => b.updateRow(idx, 'name', e.target.value)} placeholder={rowConfig?.formHints.namePlaceholder || 'Product name'} className="h-8 text-sm" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={row.price} onChange={(e) => b.updateRow(idx, 'price', e.target.value)} placeholder={isEnquiry ? 'Optional' : 'Price'} className="h-8 text-sm" />
                      </TableCell>
                      <TableCell>
                        <Input type="number" value={row.mrp} onChange={(e) => b.updateRow(idx, 'mrp', e.target.value)} placeholder="MRP" className="h-8 text-sm" />
                      </TableCell>
                      {b.hasMultipleCategories && (
                        <TableCell>
                          <Select value={row.category} onValueChange={(v) => b.updateRow(idx, 'category', v)}>
                            <SelectTrigger className="h-8 text-sm w-32 truncate"><SelectValue /></SelectTrigger>
                            <SelectContent>{allowedCategories.map(c => <SelectItem key={c.category} value={c.category}><span className="flex items-center gap-1.5"><DynamicIcon name={c.icon} size={14} /> {c.displayName}</span></SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                      )}
                      {b.anyHasSubcategories && (
                        <TableCell>
                          {rowSubs.length > 0 ? (
                            <Select value={row.subcategory_id || 'none'} onValueChange={(v) => b.updateRow(idx, 'subcategory_id', v === 'none' ? '' : v)}>
                              <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="None" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">None</SelectItem>
                                {rowSubs.map(s => <SelectItem key={s.id} value={s.id}><span className="flex items-center gap-1.5"><DynamicIcon name={s.icon || 'FolderOpen'} size={14} /> {s.display_name}</span></SelectItem>)}
                              </SelectContent>
                            </Select>
                          ) : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      <TableCell>
                        <Select value={row.action_type} onValueChange={(v) => b.updateRow(idx, 'action_type', v)}>
                          <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ACTION_TYPE_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input value={row.description} onChange={(e) => b.updateRow(idx, 'description', e.target.value)} placeholder="Optional" className="h-8 text-sm" />
                      </TableCell>
                      {b.anyShowVeg && (
                        <TableCell>
                          {rowShowVeg ? <Switch checked={row.is_veg} onCheckedChange={(v) => b.updateRow(idx, 'is_veg', v)} /> : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      {b.anyShowDuration && (
                        <TableCell>
                          {rowShowDuration ? <Input type="number" value={row.prep_time_minutes} onChange={(e) => b.updateRow(idx, 'prep_time_minutes', e.target.value)} placeholder={rowConfig?.formHints.durationLabel || 'min'} className="h-8 text-sm" /> : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                      )}
                      <TableCell>
                        <Input type="number" value={row.stock_quantity} onChange={(e) => b.updateRow(idx, 'stock_quantity', e.target.value)} placeholder="Qty" className="h-8 text-sm" />
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => b.removeRow(idx)} disabled={b.rows.length <= 1}><Trash2 size={14} /></Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {b.rows.some(r => r.error) && (
            <div className="mt-3 space-y-1">
              {b.rows.map((r, idx) => r.error ? (
                <div key={idx} className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle size={14} /><span>Row {idx + 1}: {r.error}</span></div>
              ) : null)}
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center justify-between mt-4 pt-4 border-t">
          <div className="text-sm text-muted-foreground">{b.rows.length} product{b.rows.length !== 1 ? 's' : ''} to add as drafts</div>
          <div className="flex gap-2">
            {b.saveResult && (
              <Badge variant={b.saveResult.errors > 0 ? 'destructive' : 'default'} className="gap-1">
                {b.saveResult.errors > 0 ? <AlertTriangle size={12} /> : <CheckCircle2 size={12} />}
                {b.saveResult.success} saved, {b.saveResult.errors} failed
              </Badge>
            )}
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={b.handleSave} disabled={b.isSaving || b.rows.length === 0}>
              {b.isSaving && <Loader2 size={16} className="animate-spin mr-1" />}Save All ({b.rows.length})
            </Button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>

    <Dialog open={b.showSuccessDialog} onOpenChange={(open) => !open && b.dismissSuccessDialog()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <CheckCircle2 className="h-7 w-7 text-primary" />
          </div>
          <DialogTitle className="text-center">{b.savedCount} Product{b.savedCount !== 1 ? 's' : ''} Created!</DialogTitle>
          <DialogDescription className="text-center">
            Your products have been saved as drafts. Complete these steps to make them live:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-bold">1</div>
            <div>
              <p className="text-sm font-medium">Add Images</p>
              <p className="text-xs text-muted-foreground">Products with images get significantly more views and orders</p>
            </div>
            <ImagePlus size={18} className="shrink-0 text-muted-foreground mt-0.5" />
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-bold">2</div>
            <div>
              <p className="text-sm font-medium">Review Extra Details</p>
              <p className="text-xs text-muted-foreground">Add specifications, service settings, and any missing information</p>
            </div>
            <Settings size={18} className="shrink-0 text-muted-foreground mt-0.5" />
          </div>

          <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/50">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary text-sm font-bold">3</div>
            <div>
              <p className="text-sm font-medium">Submit for Approval</p>
              <p className="text-xs text-muted-foreground">Once everything looks good, submit your products for review</p>
            </div>
            <Send size={18} className="shrink-0 text-muted-foreground mt-0.5" />
          </div>
        </div>

        <Button className="w-full mt-4" onClick={b.dismissSuccessDialog}>
          Got it — Go to Products
        </Button>
      </DialogContent>
    </Dialog>
  </>
  );
}
