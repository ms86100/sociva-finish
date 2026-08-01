// @ts-nocheck
import { FeatureGate } from '@/components/ui/FeatureGate';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ImageUpload } from '@/components/ui/image-upload';
import { useInspectionChecklist, INSPECTION_CATEGORIES } from '@/hooks/useInspectionChecklist';
import {
  ClipboardCheck, CheckCircle, XCircle, MinusCircle, AlertTriangle, Send,
  Zap, Droplets, Hammer, PaintBucket, DoorOpen, ChefHat, Bath
} from 'lucide-react';

const ICON_MAP: Record<string, any> = { Zap, Droplets, Hammer, PaintBucket, DoorOpen, ChefHat, Bath };

export default function InspectionChecklistPage() {
  const ic = useInspectionChecklist();

  if (ic.isLoading) return <AppLayout headerTitle="Inspection Checklist" showLocation={false}><div className="p-4 space-y-4"><Skeleton className="h-24 w-full" /><Skeleton className="h-40 w-full" /></div></AppLayout>;

  if (!ic.activeChecklist) {
    return (
      <AppLayout headerTitle="Inspection Checklist" showLocation={false}>
        <div className="p-4 flex flex-col items-center justify-center min-h-[60vh] text-center">
          <ClipboardCheck className="text-primary mb-4" size={48} />
          <h2 className="text-lg font-semibold">Pre-Handover Inspection</h2>
          <p className="text-sm text-muted-foreground mt-2 max-w-xs">Create a detailed inspection checklist to verify your flat before possession.</p>
          <Button className="mt-6" onClick={ic.createChecklist} disabled={ic.isCreating}>{ic.isCreating ? 'Creating...' : 'Start Inspection'}</Button>
        </div>
      </AppLayout>
    );
  }

  const checklist = ic.activeChecklist;

  return (
    <AppLayout headerTitle="Inspection Checklist" showLocation={false}>
      <FeatureGate feature="inspection">
      <div className="p-4 space-y-4">
        {/* Progress */}
        <Card className="border-primary/20"><CardContent className="p-4">
          <div className="flex items-center justify-between mb-2">
            <div><p className="font-semibold">Flat {checklist.flat_number}</p><p className="text-xs text-muted-foreground">{checklist.inspection_date && new Date(checklist.inspection_date).toLocaleDateString('en-IN')}</p></div>
            <Badge variant="outline" className={checklist.status === 'submitted' ? 'bg-success/10 text-success' : checklist.status === 'in_progress' ? 'bg-warning/10 text-warning' : 'bg-muted text-muted-foreground'}>{checklist.status.replace('_', ' ')}</Badge>
          </div>
          <Progress value={ic.progressPercent} className="h-2 mb-2" />
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>{ic.totalChecked}/{ic.items.length} checked</span>
            <div className="flex gap-3"><span className="text-success flex items-center gap-0.5"><CheckCircle size={10} /> {ic.passedCount}</span><span className="text-destructive flex items-center gap-0.5"><XCircle size={10} /> {ic.failedCount}</span></div>
          </div>
        </CardContent></Card>

        {/* Category Tabs */}
        <div className="overflow-x-auto scrollbar-hide -mx-4 px-4">
          <div className="flex gap-2 min-w-max">
            {INSPECTION_CATEGORIES.map(({ key, label, iconName }) => {
              const Icon = ICON_MAP[iconName] || Hammer;
              const catItems = ic.items.filter(i => i.category === key);
              const catFailed = catItems.filter(i => i.status === 'fail').length;
              return (
                <button key={key} onClick={() => ic.setActiveCategory(key)} className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${ic.activeCategory === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-muted/80'}`}>
                  <Icon size={14} />{label}
                  {catFailed > 0 && <span className="bg-destructive text-destructive-foreground rounded-full w-4 h-4 text-[10px] flex items-center justify-center">{catFailed}</span>}
                </button>
              );
            })}
          </div>
        </div>

        {/* Items */}
        <div className="space-y-2">
          {ic.categoryItems.map(item => (
            <Card key={item.id} className={item.status === 'fail' ? 'border-destructive/30' : item.status === 'pass' ? 'border-success/30' : ''}>
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1"><p className="text-sm font-medium">{item.item_name}</p>{item.notes && <p className="text-xs text-muted-foreground mt-0.5">{item.notes}</p>}</div>
                  <div className="flex gap-1">
                    <button onClick={() => ic.updateItemStatus(item.id, 'pass')} className={`p-2 rounded-lg transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center ${item.status === 'pass' ? 'bg-success/20 text-success' : 'bg-muted text-muted-foreground'}`}><CheckCircle size={18} /></button>
                    <button onClick={() => ic.updateItemStatus(item.id, 'fail')} className={`p-2 rounded-lg transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center ${item.status === 'fail' ? 'bg-destructive/20 text-destructive' : 'bg-muted text-muted-foreground'}`}><XCircle size={18} /></button>
                    <button onClick={() => ic.updateItemStatus(item.id, 'na')} className={`p-2 rounded-lg transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center ${item.status === 'na' ? 'bg-muted text-foreground' : 'bg-muted text-muted-foreground'}`}><MinusCircle size={18} /></button>
                  </div>
                </div>
                {item.status === 'fail' && (
                  <div className="mt-2 space-y-2">
                    <Textarea className="text-xs h-16" placeholder="Describe the issue..." value={item.notes || ''} onChange={e => ic.updateItemNotes(item.id, e.target.value)} />
                    <ImageUpload value={item.photo_urls?.[0] || null} onChange={async (url) => { if (url) ic.updateItemPhotos(item.id, url); }} folder="inspection" userId={ic.user?.id || ''} />
                    {item.photo_urls?.length > 0 && <div className="flex gap-1 flex-wrap">{item.photo_urls.map((url, i) => <img key={i} src={url} alt={`Issue ${i + 1}`} className="w-12 h-12 rounded object-cover border border-border" />)}</div>}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>

        {checklist.status !== 'submitted' && ic.totalChecked > 0 && <Button className="w-full" onClick={ic.submitChecklist}><Send size={16} className="mr-2" />Submit Inspection Report ({ic.failedCount} issues found)</Button>}

        {checklist.status === 'submitted' && (checklist as any).builder_acknowledged_at && (
          <Card className="border-success/30 bg-success/5"><CardContent className="p-3"><div className="flex items-center gap-2 text-success"><CheckCircle size={16} /><div><p className="text-sm font-medium">Builder Acknowledged</p><p className="text-[10px] text-muted-foreground">{new Date((checklist as any).builder_acknowledged_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p></div></div>{(checklist as any).builder_notes && <p className="text-xs mt-2 text-muted-foreground">{(checklist as any).builder_notes}</p>}</CardContent></Card>
        )}

        {checklist.status === 'submitted' && !(checklist as any).builder_acknowledged_at && (
          <Card className="border-warning/30 bg-warning/5"><CardContent className="p-3 text-center"><p className="text-xs text-warning font-medium">⏳ Awaiting builder acknowledgement</p></CardContent></Card>
        )}

        {checklist.status === 'submitted' && ic.failedCount > 0 && (
          <Button variant="destructive" className="w-full" onClick={ic.convertToSnags}><AlertTriangle size={16} className="mr-2" />Convert {ic.failedCount} Failed Items to Snag Tickets</Button>
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
