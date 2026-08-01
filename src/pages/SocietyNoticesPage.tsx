// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { Megaphone, Plus, Pin, Clock, User } from 'lucide-react';
import { format } from 'date-fns';

interface Notice {
  id: string;
  title: string;
  body: string;
  category: string;
  is_pinned: boolean;
  created_at: string;
  posted_by: string;
  poster?: { name: string } | null;
}

const NOTICE_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'safety', label: 'Safety' },
  { value: 'event', label: 'Event' },
  { value: 'rule_change', label: 'Rule Change' },
  { value: 'financial', label: 'Financial' },
];

export default function SocietyNoticesPage() {
  const { user, profile, isAdmin, isSocietyAdmin, isBuilderMember, effectiveSocietyId } = useAuth();
  const canPost = isAdmin || isSocietyAdmin || isBuilderMember;
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState('general');
  const [isPinned, setIsPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchNotices = useCallback(async () => {
    if (!effectiveSocietyId) return;
    setLoading(true);
    const { data } = await supabase
      .from('society_notices')
      .select('*, poster:profiles!society_notices_posted_by_fkey(name)')
      .eq('society_id', effectiveSocietyId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50);
    setNotices((data as any) || []);
    setLoading(false);
  }, [effectiveSocietyId]);

  useEffect(() => { fetchNotices(); }, [fetchNotices]);

  const handlePost = async () => {
    if (!title.trim() || !body.trim() || !user || !effectiveSocietyId) return;
    setSubmitting(true);
    const { error } = await supabase.from('society_notices').insert({
      society_id: effectiveSocietyId,
      title: title.trim(),
      body: body.trim(),
      category,
      is_pinned: isPinned,
      posted_by: user.id,
    } as any);
    if (error) { toast.error(friendlyError(error)); }
    else {
      toast.success('Notice posted & residents notified');
      setSheetOpen(false);
      setTitle(''); setBody(''); setCategory('general'); setIsPinned(false);
      fetchNotices();
    }
    setSubmitting(false);
  };

  const categoryColor = (cat: string) => {
    const colors: Record<string, string> = {
      safety: 'destructive',
      maintenance: 'secondary',
      event: 'default',
      rule_change: 'outline',
      financial: 'secondary',
    };
    return (colors[cat] || 'outline') as any;
  };

  return (
    <AppLayout headerTitle="Notices" showLocation={false}>
      <FeatureGate feature="society_notices">
      <div className="p-4 space-y-4">
        {canPost && (
          <Drawer open={sheetOpen} onOpenChange={setSheetOpen}>
            <DrawerTrigger asChild>
              <Button className="w-full gap-2">
                <Plus size={16} /> Post Notice
              </Button>
            </DrawerTrigger>
            <DrawerContent className="max-h-[85vh] overflow-y-auto">
              <DrawerHeader><DrawerTitle>Post Official Notice</DrawerTitle></DrawerHeader>
              <div className="space-y-4 mt-4">
                <div>
                  <Label>Title *</Label>
                  <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Notice title" />
                </div>
                <div>
                  <Label>Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {NOTICE_CATEGORIES.map(c => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Body *</Label>
                  <Textarea value={body} onChange={e => setBody(e.target.value)} placeholder="Notice content..." rows={5} />
                </div>
                   <div className="flex items-center gap-2 min-h-[40px]">
                  <input type="checkbox" id="pin" checked={isPinned} onChange={e => setIsPinned(e.target.checked)} className="w-4 h-4 accent-primary" />
                  <Label htmlFor="pin" className="text-sm cursor-pointer">Pin this notice</Label>
                </div>
                <Button onClick={handlePost} disabled={submitting || !title.trim() || !body.trim()} className="w-full">
                  {submitting ? 'Posting...' : 'Post & Notify All Residents'}
                </Button>
              </div>
            </DrawerContent>
          </Drawer>
        )}

         {loading ? (
          [1, 2, 3].map(i => <Skeleton key={i} className="h-24 w-full rounded-xl" />)
        ) : notices.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Megaphone size={40} className="mx-auto mb-3 opacity-40" />
            <p className="font-medium">No notices yet</p>
            <p className="text-sm mt-1">Official notices from the committee will appear here</p>
          </div>
        ) : (
          notices.map(notice => (
            <Card key={notice.id} className={notice.is_pinned ? 'border-primary/30 bg-primary/5' : ''}>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      {notice.is_pinned && <Pin size={12} className="text-primary" />}
                      <p className="font-semibold text-sm">{notice.title}</p>
                      <Badge variant={categoryColor(notice.category)} className="text-[10px]">
                        {notice.category.replace('_', ' ')}
                      </Badge>
                    </div>
                  </div>
                </div>
                <p className="text-sm text-foreground/80 whitespace-pre-wrap">{notice.body}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <User size={10} /> {notice.poster?.name || 'Admin'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock size={10} /> {format(new Date(notice.created_at), 'dd MMM yyyy, h:mm a')}
                  </span>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
