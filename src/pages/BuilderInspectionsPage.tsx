// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { ClipboardCheck, CheckCircle, XCircle, Eye, Loader2, Send } from 'lucide-react';

interface Checklist {
  id: string;
  flat_number: string;
  inspection_date: string | null;
  status: string;
  overall_score: number;
  total_items: number;
  passed_items: number;
  failed_items: number;
  notes: string | null;
  submitted_at: string | null;
  builder_acknowledged_at: string | null;
  builder_notes: string | null;
  resident: { name: string } | null;
}

interface InspectionItem {
  id: string;
  category: string;
  item_name: string;
  status: string;
  severity: string;
  notes: string | null;
  photo_urls: string[];
}

export default function BuilderInspectionsPage() {
  const { user, effectiveSocietyId } = useAuth();
  const [checklists, setChecklists] = useState<Checklist[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedChecklist, setSelectedChecklist] = useState<Checklist | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [builderNotes, setBuilderNotes] = useState('');
  const [acknowledging, setAcknowledging] = useState(false);

  useEffect(() => {
    if (effectiveSocietyId) fetchChecklists();
  }, [effectiveSocietyId]);

  const fetchChecklists = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('inspection_checklists')
      .select('*, resident:profiles!inspection_checklists_resident_id_fkey(name)')
      .eq('society_id', effectiveSocietyId!)
      .eq('status', 'submitted')
      .order('submitted_at', { ascending: false });
    setChecklists((data as any) || []);
    setLoading(false);
  };

  const viewChecklist = async (c: Checklist) => {
    setSelectedChecklist(c);
    setBuilderNotes(c.builder_notes || '');
    const { data } = await supabase
      .from('inspection_items')
      .select('*')
      .eq('checklist_id', c.id)
      .order('display_order');
    setItems((data as any) || []);
  };

  const handleAcknowledge = async () => {
    if (!selectedChecklist || !user) return;
    setAcknowledging(true);
    try {
      const { error } = await supabase
        .from('inspection_checklists')
        .update({
          builder_acknowledged_at: new Date().toISOString(),
          builder_acknowledged_by: user.id,
          builder_notes: builderNotes.trim() || null,
        } as any)
        .eq('id', selectedChecklist.id);
      if (error) throw error;
      toast.success('Inspection acknowledged');
      setSelectedChecklist(null);
      fetchChecklists();
    } catch (err: any) {
      toast.error(friendlyError(err));
    } finally {
      setAcknowledging(false);
    }
  };

  const failedItems = items.filter(i => i.status === 'fail');

  if (loading) {
    return (
      <AppLayout headerTitle="Submitted Inspections" showLocation={false}>
        <div className="p-4 space-y-4">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Submitted Inspections" showLocation={false}>
      <div className="p-4 space-y-4">
        {checklists.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <ClipboardCheck className="mx-auto mb-3" size={40} />
            <p className="font-semibold">No Submitted Inspections</p>
            <p className="text-sm mt-1">Inspection reports from residents will appear here.</p>
          </div>
        ) : (
          checklists.map(c => (
            <Card key={c.id} className={c.builder_acknowledged_at ? 'border-success/20 opacity-70' : 'border-warning/20'}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">Flat {c.flat_number}</p>
                      {c.builder_acknowledged_at ? (
                        <Badge variant="outline" className="text-[10px] bg-success/10 text-success">Acknowledged</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[10px] bg-warning/10 text-warning">Pending Review</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      By {(c.resident as any)?.name || 'Resident'} · {c.submitted_at ? new Date(c.submitted_at).toLocaleDateString('en-IN') : ''}
                    </p>
                    <div className="flex gap-3 mt-2 text-xs">
                      <span className="text-success flex items-center gap-0.5"><CheckCircle size={10} /> {c.passed_items}</span>
                      <span className="text-destructive flex items-center gap-0.5"><XCircle size={10} /> {c.failed_items}</span>
                      <span className="text-muted-foreground">Score: {c.overall_score}%</span>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="text-xs gap-1" onClick={() => viewChecklist(c)}>
                    <Eye size={12} /> View
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Detail Sheet */}
      <Drawer open={!!selectedChecklist} onOpenChange={(open) => { if (!open) setSelectedChecklist(null); }}>
        <DrawerContent className="max-h-[85vh] overflow-y-auto">
          <DrawerHeader>
            <DrawerTitle>Inspection – Flat {selectedChecklist?.flat_number}</DrawerTitle>
          </DrawerHeader>
          {selectedChecklist && (
            <div className="mt-4 space-y-4">
              {/* Summary */}
              <div className="flex gap-3 text-center">
                <Card className="flex-1"><CardContent className="p-3">
                  <p className="text-lg font-bold text-success">{selectedChecklist.passed_items}</p>
                  <p className="text-[10px] text-muted-foreground">Passed</p>
                </CardContent></Card>
                <Card className="flex-1"><CardContent className="p-3">
                  <p className="text-lg font-bold text-destructive">{selectedChecklist.failed_items}</p>
                  <p className="text-[10px] text-muted-foreground">Failed</p>
                </CardContent></Card>
                <Card className="flex-1"><CardContent className="p-3">
                  <p className="text-lg font-bold">{selectedChecklist.overall_score}%</p>
                  <p className="text-[10px] text-muted-foreground">Score</p>
                </CardContent></Card>
              </div>

              {/* Failed Items */}
              {failedItems.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-destructive mb-2">Failed Items ({failedItems.length})</p>
                  <div className="space-y-2">
                    {failedItems.map(item => (
                      <Card key={item.id} className="border-destructive/20">
                        <CardContent className="p-3">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-[9px] capitalize">{item.category.replace('_', ' ')}</Badge>
                            <p className="text-sm font-medium">{item.item_name}</p>
                          </div>
                          {item.notes && <p className="text-xs text-muted-foreground mt-1">{item.notes}</p>}
                          {item.photo_urls?.length > 0 && (
                            <div className="flex gap-1 mt-2">
                              {item.photo_urls.map((url, i) => (
                                <img key={i} src={url} alt="" className="w-12 h-12 rounded object-cover border border-border" />
                              ))}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Acknowledge */}
              {!selectedChecklist.builder_acknowledged_at && (
                <div className="space-y-3 pt-2 border-t border-border">
                  <Textarea
                    value={builderNotes}
                    onChange={e => setBuilderNotes(e.target.value)}
                    placeholder="Response to resident (optional)..."
                    rows={3}
                  />
                  <Button className="w-full" onClick={handleAcknowledge} disabled={acknowledging}>
                    {acknowledging ? <Loader2 size={16} className="animate-spin mr-2" /> : <Send size={16} className="mr-2" />}
                    Acknowledge Inspection
                  </Button>
                </div>
              )}

              {selectedChecklist.builder_acknowledged_at && (
                <Card className="border-success/30 bg-success/5">
                  <CardContent className="p-3 text-center">
                    <CheckCircle size={16} className="mx-auto text-success mb-1" />
                    <p className="text-sm font-medium text-success">Already Acknowledged</p>
                    {selectedChecklist.builder_notes && (
                      <p className="text-xs text-muted-foreground mt-1">{selectedChecklist.builder_notes}</p>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </AppLayout>
  );
}
