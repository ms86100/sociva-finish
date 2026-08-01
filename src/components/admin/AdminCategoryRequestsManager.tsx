// @ts-nocheck
import { useState, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import {
  useCategoryRequests, useCategoryRequestCounts,
  useApproveAsNewCategory, useMergeCategoryRequest, useRejectCategoryRequest,
  useApproveAsNewSubcategory, useMergeSubcategoryRequest,
  type CategoryRequestRow,
} from '@/hooks/admin/useCategoryRequests';
import { useParentGroups } from '@/hooks/useParentGroups';
import { useCategoryConfig } from '@/hooks/queries/useCategoryConfig';
import { useSubcategories } from '@/hooks/useSubcategories';
import { Check, X, GitMerge, AlertCircle, Inbox, User, Calendar, ChevronRight, Sparkles, Layers } from 'lucide-react';

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

const STATUS_TONE: Record<string, string> = {
  pending: 'bg-amber-500/15 text-amber-700 border-amber-500/30',
  approved: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30',
  merged: 'bg-blue-500/15 text-blue-700 border-blue-500/30',
  rejected: 'bg-rose-500/15 text-rose-700 border-rose-500/30',
  duplicate: 'bg-muted text-muted-foreground border-border',
};

export function AdminCategoryRequestsManager() {
  const [status, setStatus] = useState<string>('pending');
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<CategoryRequestRow | null>(null);

  const { data: counts } = useCategoryRequestCounts();
  const { data: requests = [], isLoading } = useCategoryRequests(status);
  const { data: categories = [] } = useCategoryConfig();

  const filtered = useMemo(() => {
    if (!search.trim()) return requests;
    const q = search.toLowerCase();
    return requests.filter(r =>
      r.requested_name.toLowerCase().includes(q) ||
      (r.example_product ?? '').toLowerCase().includes(q) ||
      (r.requester?.display_name ?? '').toLowerCase().includes(q)
    );
  }, [requests, search]);

  // Duplicate detection: pending requests sharing normalized_name
  const duplicateNames = useMemo(() => {
    const seen = new Map<string, number>();
    requests.forEach(r => {
      if (r.status !== 'pending' || !r.normalized_name) return;
      seen.set(r.normalized_name, (seen.get(r.normalized_name) ?? 0) + 1);
    });
    return new Set(Array.from(seen.entries()).filter(([, c]) => c > 1).map(([n]) => n));
  }, [requests]);

  // Match against existing category to suggest merge
  const existingMatch = useMemo(() => {
    const map = new Map<string, any>();
    (categories as any[]).forEach((c: any) => {
      map.set(c.category, c);
    });
    return map;
  }, [categories]);

  return (
    <div className="space-y-4">
      {/* Counters */}
      <div className="grid grid-cols-4 gap-2">
        {(['pending', 'approved', 'merged', 'rejected'] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={`p-3 rounded-xl border text-left transition-all ${
              status === s ? 'border-primary bg-primary/5' : 'border-border/40 bg-muted/30'
            }`}
          >
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">{s}</div>
            <div className="text-lg font-bold text-foreground">{counts?.[s] ?? 0}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by name, seller, example…"
          className="h-9 text-xs"
        />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-32 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="merged">Merged</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-2">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Inbox size={32} className="mx-auto mb-2 opacity-50" />
          <p className="text-sm">No requests in this status.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(r => {
            const isDup = duplicateNames.has(r.normalized_name ?? '');
            const possibleMatch = existingMatch.get(slugify(r.requested_name));
            return (
              <Card
                key={r.id}
                className="border border-border/40 hover:border-primary/40 transition-all cursor-pointer rounded-xl"
                onClick={() => setActive(r)}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-sm">{r.requested_name}</span>
                      <Badge variant="outline" className={`text-[9px] px-1.5 py-0 h-5 ${STATUS_TONE[r.status]}`}>
                        {r.status}
                      </Badge>
                      {r.request_kind === 'subcategory' && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-5 border-purple-500/40 text-purple-700 gap-1">
                          <Layers size={8} /> subcategory
                        </Badge>
                      )}
                      {isDup && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-5 border-amber-500/40 text-amber-700">
                          duplicate
                        </Badge>
                      )}
                      {possibleMatch && r.request_kind === 'category' && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-5 border-blue-500/40 text-blue-700">
                          matches existing
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                      <span className="flex items-center gap-1"><User size={10} /> {r.requester?.display_name ?? r.requested_by.slice(0, 8)}</span>
                      <span className="flex items-center gap-1"><Calendar size={10} /> {formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}</span>
                      {r.parent_group_hint && <span>hint: {r.parent_group_hint}</span>}
                    </div>
                    {r.example_product && (
                      <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1 italic">"{r.example_product}"</p>
                    )}
                  </div>
                  <ChevronRight size={14} className="text-muted-foreground" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <RequestDetailSheet
        request={active}
        onClose={() => setActive(null)}
      />
    </div>
  );
}

/* ───────── Detail sheet with Approve / Merge / Reject ───────── */

function RequestDetailSheet({ request, onClose }: { request: CategoryRequestRow | null; onClose: () => void }) {
  const { groups: parentGroups = [] } = useParentGroups();
  const { data: categories = [] } = useCategoryConfig();
  const approveMut = useApproveAsNewCategory();
  const mergeMut = useMergeCategoryRequest();
  const rejectMut = useRejectCategoryRequest();
  const approveSubMut = useApproveAsNewSubcategory();
  const mergeSubMut = useMergeSubcategoryRequest();

  const isSubcat = request?.request_kind === 'subcategory';
  const parentCategory = isSubcat
    ? (categories as any[]).find((c: any) => c.id === request?.parent_category_config_id)
    : null;
  const { data: parentSubs = [] } = useSubcategories(isSubcat ? request?.parent_category_config_id ?? undefined : undefined);

  const [mode, setMode] = useState<'approve' | 'merge' | 'reject'>('approve');

  // Approve form
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [parentGroup, setParentGroup] = useState('');
  const [icon, setIcon] = useState('📦');

  // Merge form
  const [mergeTarget, setMergeTarget] = useState('');         // category slug OR subcategory id

  // Reject form
  const [reason, setReason] = useState('');
  const [alternatives, setAlternatives] = useState<string[]>([]);

  // Initialize when a request is selected
  useMemo(() => {
    if (!request) return;
    setMode('approve');
    setSlug(slugify(request.requested_name));
    setDisplayName(request.requested_name);
    setParentGroup(request.parent_group_hint ?? '');
    setMergeTarget('');
    setReason('');
    setAlternatives([]);
  }, [request?.id]);

  if (!request) return null;
  const readOnly = request.status !== 'pending';

  const handleApprove = async () => {
    if (!slug || !displayName) return;
    if (isSubcat) {
      if (!parentCategory) return;
      await approveSubMut.mutateAsync({
        request,
        parentCategoryConfigId: parentCategory.id,
        parentCategorySlug: parentCategory.category,
        parentCategoryDisplayName: parentCategory.displayName ?? parentCategory.display_name,
        slug,
        displayName,
        icon,
      });
    } else {
      if (!parentGroup) return;
      await approveMut.mutateAsync({
        request, category: slug, displayName, parentGroup, icon,
      });
    }
    onClose();
  };

  const handleMerge = async () => {
    if (!mergeTarget) return;
    if (isSubcat) {
      const target = parentSubs.find((s: any) => s.id === mergeTarget);
      if (!target || !parentCategory) return;
      await mergeSubMut.mutateAsync({
        request,
        parentCategorySlug: parentCategory.category,
        targetSubcategoryId: target.id,
        targetSubcategoryName: target.display_name,
      });
    } else {
      const target = (categories as any[]).find((c: any) => c.category === mergeTarget);
      await mergeMut.mutateAsync({
        request,
        targetCategory: mergeTarget,
        targetDisplayName: target?.displayName ?? target?.display_name ?? mergeTarget,
      });
    }
    onClose();
  };

  const handleReject = async () => {
    if (!reason.trim()) return;
    await rejectMut.mutateAsync({ request, reason, suggestedAlternatives: alternatives });
    onClose();
  };

  return (
    <Sheet open={!!request} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles size={16} className="text-primary" />
            {request.requested_name}
            {isSubcat && (
              <Badge variant="outline" className="text-[9px] border-purple-500/40 text-purple-700 gap-1 ml-1">
                <Layers size={8} /> subcategory
              </Badge>
            )}
          </SheetTitle>
          <SheetDescription>
            Requested by {request.requester?.display_name ?? request.requested_by.slice(0, 8)} • {formatDistanceToNow(new Date(request.created_at), { addSuffix: true })}
            {isSubcat && parentCategory && (
              <> • under <span className="font-medium">{parentCategory.displayName ?? parentCategory.display_name}</span></>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 mt-4">
          {request.example_product && (
            <div className="p-3 rounded-lg bg-muted/40 text-xs">
              <div className="font-semibold mb-1">Example product</div>
              <p className="text-muted-foreground italic">"{request.example_product}"</p>
            </div>
          )}

          {request.draft_product_id && (
            <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 text-xs flex items-center gap-2">
              <AlertCircle size={14} className="text-blue-600 shrink-0" />
              <span>This request is linked to a pending product draft — it will be auto-relinked on approval.</span>
            </div>
          )}

          {readOnly ? (
            <div className="p-3 rounded-lg bg-muted/40 text-xs space-y-1.5">
              <div><span className="font-semibold">Status:</span> {request.status}</div>
              {request.created_category && <div><span className="font-semibold">Created category:</span> {request.created_category}</div>}
              {request.merge_target_category && <div><span className="font-semibold">Merged into category:</span> {request.merge_target_category}</div>}
              {request.created_subcategory_id && <div><span className="font-semibold">Created subcategory id:</span> <span className="font-mono text-[10px]">{request.created_subcategory_id}</span></div>}
              {request.merge_target_subcategory_id && <div><span className="font-semibold">Merged into subcategory id:</span> <span className="font-mono text-[10px]">{request.merge_target_subcategory_id}</span></div>}
              {request.rejection_reason && <div><span className="font-semibold">Reason:</span> {request.rejection_reason}</div>}
            </div>
          ) : (
            <>
              <Tabs value={mode} onValueChange={(v: any) => setMode(v)}>
                <TabsList className="grid grid-cols-3 w-full">
                  <TabsTrigger value="approve" className="text-xs"><Check size={12} className="mr-1" /> Approve</TabsTrigger>
                  <TabsTrigger value="merge" className="text-xs"><GitMerge size={12} className="mr-1" /> Merge</TabsTrigger>
                  <TabsTrigger value="reject" className="text-xs"><X size={12} className="mr-1" /> Reject</TabsTrigger>
                </TabsList>
              </Tabs>

              {mode === 'approve' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Display name</Label>
                    <Input value={displayName} onChange={e => setDisplayName(e.target.value)} className="h-9 text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Slug</Label>
                    <Input value={slug} onChange={e => setSlug(slugify(e.target.value))} className="h-9 text-xs font-mono" />
                  </div>
                  {isSubcat ? (
                    <div className="p-2 rounded-lg bg-muted/40 text-[11px] text-muted-foreground">
                      Will be added under <span className="font-semibold text-foreground">{parentCategory?.displayName ?? parentCategory?.display_name ?? '—'}</span>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <Label className="text-xs">Section / parent group</Label>
                      <Select value={parentGroup} onValueChange={setParentGroup}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Choose a section" /></SelectTrigger>
                        <SelectContent>
                          {parentGroups.map((g: any) => (
                            <SelectItem key={g.slug} value={g.slug}>{g.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label className="text-xs">Icon (emoji)</Label>
                    <Input value={icon} onChange={e => setIcon(e.target.value)} className="h-9 text-xs w-20" />
                  </div>
                  <Button
                    onClick={handleApprove}
                    disabled={(isSubcat ? approveSubMut.isPending : approveMut.isPending) || !slug || !displayName || (!isSubcat && !parentGroup) || (isSubcat && !parentCategory)}
                    className="w-full"
                  >
                    Approve & publish {isSubcat ? 'subcategory' : 'category'}
                  </Button>
                </div>
              )}

              {mode === 'merge' && (
                <div className="space-y-3">
                  {isSubcat ? (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Merge into existing subcategory of {parentCategory?.displayName ?? parentCategory?.display_name}</Label>
                        <Select value={mergeTarget} onValueChange={setMergeTarget}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick a subcategory" /></SelectTrigger>
                          <SelectContent>
                            {parentSubs.map((s: any) => (
                              <SelectItem key={s.id} value={s.id}>{s.display_name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleMerge} disabled={mergeSubMut.isPending || !mergeTarget} className="w-full">
                        Merge & notify seller
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="space-y-1">
                        <Label className="text-xs">Merge into existing category</Label>
                        <Select value={mergeTarget} onValueChange={setMergeTarget}>
                          <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Pick a category" /></SelectTrigger>
                          <SelectContent>
                            {(categories as any[])
                              .filter((c: any) => c.isActive ?? c.is_active)
                              .map((c: any) => (
                                <SelectItem key={c.category} value={c.category}>
                                  {(c.displayName ?? c.display_name)} — {c.parentGroup ?? c.parent_group}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button onClick={handleMerge} disabled={mergeMut.isPending || !mergeTarget} className="w-full">
                        Merge & notify seller
                      </Button>
                    </>
                  )}
                </div>
              )}

              {mode === 'reject' && (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Reason (shown to seller)</Label>
                    <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} className="text-xs" placeholder="e.g. Not a permitted category on this platform." />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Suggest alternatives (optional)</Label>
                    <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 border border-border/40 rounded-lg">
                      {(categories as any[])
                        .filter((c: any) => c.isActive ?? c.is_active)
                        .slice(0, 30)
                        .map((c: any) => {
                          const sel = alternatives.includes(c.category);
                          return (
                            <button
                              key={c.category}
                              type="button"
                              onClick={() => setAlternatives(prev => sel ? prev.filter(s => s !== c.category) : [...prev, c.category])}
                              className={`text-[10px] px-2 py-1 rounded-md border transition ${sel ? 'bg-primary text-primary-foreground border-primary' : 'bg-muted/40 border-border/40'}`}
                            >
                              {(c.displayName ?? c.display_name)}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                  <Button onClick={handleReject} disabled={rejectMut.isPending || !reason.trim()} variant="destructive" className="w-full">
                    Reject & notify seller
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
