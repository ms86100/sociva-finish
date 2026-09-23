// @ts-nocheck
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Store, ChevronRight, Plus, Clock, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { resolveStoreCategoryLabel } from '@/lib/store-category-label';
import { isShelvedSellerStore, displaySellerStoreName } from '@/lib/seller-journey';
import {
  draftProgressPercent,
  isIncompleteDraftStore,
  listIncompleteDraftStores,
  parseOnboardingMeta,
  shouldGateNewStoreOnboarding,
  stoppedAtLabel,
} from '@/lib/onboarding-state';
import type { CategoryConfig } from '@/types/categories';

interface StoreRow {
  id: string;
  business_name: string;
  verification_status?: string | null;
  primary_group?: string | null;
  categories?: string[] | null;
  onboarding_meta?: unknown;
  updated_at?: string | null;
}

interface ExistingStoresOnboardingPanelProps {
  stores: StoreRow[];
  configs: CategoryConfig[];
  currentDraftId?: string | null;
  onResumeDraft: (store: StoreRow) => void | Promise<void>;
  onAddNewStore: () => void;
  onManageStore: (storeId: string) => void;
  onRenameDraft?: (storeId: string, name: string) => Promise<boolean>;
  onDeleteDraft?: (storeId: string) => Promise<boolean>;
}

export function ExistingStoresOnboardingPanel({
  stores,
  configs,
  currentDraftId,
  onResumeDraft,
  onAddNewStore,
  onManageStore,
  onRenameDraft,
  onDeleteDraft,
}: ExistingStoresOnboardingPanelProps) {
  const visibleStores = (stores || []).filter((s) => !isShelvedSellerStore(s));
  const incompleteDrafts = useMemo(
    () => listIncompleteDraftStores(visibleStores),
    [visibleStores],
  );

  const [renameStore, setRenameStore] = useState<StoreRow | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);

  const [deleteStore, setDeleteStore] = useState<StoreRow | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const [gateOpen, setGateOpen] = useState(false);
  const [gateDeleteConfirm, setGateDeleteConfirm] = useState(false);
  const [gateBusy, setGateBusy] = useState(false);

  if (!visibleStores.length) return null;

  const mostRecentDraft = [...incompleteDrafts].sort((a, b) => {
    const ta = a.updated_at ? Date.parse(a.updated_at) : 0;
    const tb = b.updated_at ? Date.parse(b.updated_at) : 0;
    return tb - ta;
  })[0] || incompleteDrafts[0] || null;

  const handleAddNewClick = () => {
    if (shouldGateNewStoreOnboarding(incompleteDrafts)) {
      setGateOpen(true);
      return;
    }
    onAddNewStore();
  };

  const handleRenameSubmit = async () => {
    if (!renameStore || !onRenameDraft) return;
    setRenameBusy(true);
    try {
      const ok = await onRenameDraft(renameStore.id, renameValue);
      if (ok) {
        setRenameStore(null);
        setRenameValue('');
      }
    } finally {
      setRenameBusy(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteStore || !onDeleteDraft) return;
    setDeleteBusy(true);
    try {
      const ok = await onDeleteDraft(deleteStore.id);
      if (ok) setDeleteStore(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  const handleGateDeleteAndStart = async () => {
    if (!mostRecentDraft || !onDeleteDraft) return;
    setGateBusy(true);
    try {
      const ok = await onDeleteDraft(mostRecentDraft.id);
      if (ok) {
        setGateDeleteConfirm(false);
        setGateOpen(false);
        onAddNewStore();
      }
    } finally {
      setGateBusy(false);
    }
  };

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card p-4 space-y-3">
      <div>
        <h2 className="text-sm font-bold">Your stores</h2>
        <p className="text-xs text-muted-foreground mt-0.5">
          Sociva allows one store per category. Resume an unfinished setup or add a new one in a different category.
        </p>
      </div>
      <div className="space-y-2">
        {visibleStores.map((store) => {
          const status = store.verification_status || 'draft';
          const categoryLabel = resolveStoreCategoryLabel(store, configs);
          const isDraft = isIncompleteDraftStore(store);
          const isActive = store.id === currentDraftId;
          const meta = parseOnboardingMeta(store.onboarding_meta);
          const progress = draftProgressPercent(meta?.step);
          const stopped = stoppedAtLabel(meta);

          return (
            <div
              key={store.id}
              className={cn(
                'flex flex-col gap-2 p-3 rounded-xl border',
                isActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/30',
              )}
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Store size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate">
                    {displaySellerStoreName(store.business_name, 'Untitled store')}
                  </p>
                  <p className="text-[11px] text-muted-foreground truncate">{categoryLabel}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {status === 'approved' && (
                      <Badge variant="outline" className="text-[9px] h-4 text-success border-success">
                        <CheckCircle2 size={8} className="mr-0.5" /> Approved
                      </Badge>
                    )}
                    {status === 'pending' && (
                      <Badge variant="outline" className="text-[9px] h-4 text-warning border-warning">
                        <Clock size={8} className="mr-0.5" /> Under review
                      </Badge>
                    )}
                    {isDraft && (
                      <Badge variant="outline" className="text-[9px] h-4">
                        Setup incomplete · {progress}% completed
                      </Badge>
                    )}
                    {status === 'rejected' && !isDraft && (
                      <Badge variant="outline" className="text-[9px] h-4 text-destructive border-destructive">
                        Needs updates
                      </Badge>
                    )}
                  </div>
                  {isDraft && (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      You stopped at: <span className="text-foreground font-medium">{stopped}</span>
                    </p>
                  )}
                </div>
                {!isDraft && (
                  <div className="shrink-0">
                    <Button size="sm" variant="outline" onClick={() => onManageStore(store.id)}>
                      Manage<ChevronRight size={14} className="ml-0.5" />
                    </Button>
                  </div>
                )}
              </div>

              {isDraft && (
                <div className="flex flex-col gap-2 pl-[52px]">
                  <Button
                    size="sm"
                    className="w-full sm:w-auto"
                    variant={isActive ? 'secondary' : 'default'}
                    onClick={() => void onResumeDraft(store)}
                  >
                    Continue Setup
                  </Button>
                  <div className="flex items-center gap-3">
                    {onRenameDraft && (
                      <button
                        type="button"
                        className="text-[11px] text-primary underline-offset-2 hover:underline"
                        onClick={() => {
                          setRenameStore(store);
                          setRenameValue(
                            displaySellerStoreName(store.business_name, '') === 'Untitled store'
                              ? ''
                              : displaySellerStoreName(store.business_name, ''),
                          );
                        }}
                      >
                        Rename
                      </button>
                    )}
                    {onDeleteDraft && (
                      <button
                        type="button"
                        className="text-[11px] text-destructive underline-offset-2 hover:underline"
                        onClick={() => setDeleteStore(store)}
                      >
                        Delete Draft
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <Button variant="outline" className="w-full" onClick={handleAddNewClick}>
        <Plus size={16} className="mr-2" />Add store in a new category
      </Button>
      <p className="text-[10px] text-center text-muted-foreground">
        Manage stores anytime from the{' '}
        <Link to="/seller" className="text-primary underline">Seller Dashboard</Link>
      </p>

      {/* Rename dialog */}
      <Dialog
        open={!!renameStore}
        onOpenChange={(open) => {
          if (!open) {
            setRenameStore(null);
            setRenameValue('');
          }
        }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Rename store</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground">
            Buyers will see this name on your store, products, and orders.
          </p>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            placeholder="e.g. Priya's Kitchen"
            maxLength={80}
            autoFocus
          />
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setRenameStore(null)} disabled={renameBusy}>
              Cancel
            </Button>
            <Button onClick={() => void handleRenameSubmit()} disabled={renameBusy || !renameValue.trim()}>
              {renameBusy ? 'Saving…' : 'Save name'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete draft confirm */}
      <AlertDialog
        open={!!deleteStore}
        onOpenChange={(open) => {
          if (!open && !deleteBusy) setDeleteStore(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this unfinished store?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove your incomplete setup and the information saved in it.
              You can start again whenever you&apos;re ready.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteBusy}
              onClick={(e) => {
                e.preventDefault();
                void handleDeleteConfirm();
              }}
            >
              {deleteBusy ? 'Removing…' : 'Delete Draft'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* One-draft gate when adding another category */}
      <AlertDialog
        open={gateOpen}
        onOpenChange={(open) => {
          if (!open && !gateBusy) {
            setGateOpen(false);
            setGateDeleteConfirm(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>You already have a store setup in progress</AlertDialogTitle>
            <AlertDialogDescription>
              {mostRecentDraft
                ? `Continue “${displaySellerStoreName(mostRecentDraft.business_name, 'Untitled store')}” where you left off, or delete it and start again.`
                : 'Continue your unfinished setup, or delete it and start again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!gateDeleteConfirm ? (
            <AlertDialogFooter className="flex-col sm:flex-col gap-2">
              <AlertDialogAction
                disabled={gateBusy || !mostRecentDraft}
                onClick={(e) => {
                  e.preventDefault();
                  if (mostRecentDraft) {
                    setGateOpen(false);
                    void onResumeDraft(mostRecentDraft);
                  }
                }}
              >
                Continue Setup
              </AlertDialogAction>
              <Button
                variant="outline"
                className="text-destructive border-destructive/40"
                disabled={gateBusy || !onDeleteDraft}
                onClick={() => setGateDeleteConfirm(true)}
              >
                Delete & Start Again
              </Button>
              <AlertDialogCancel disabled={gateBusy}>Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                This will remove your incomplete setup. You can start a new store right after.
              </p>
              <AlertDialogFooter>
                <Button
                  variant="outline"
                  disabled={gateBusy}
                  onClick={() => setGateDeleteConfirm(false)}
                >
                  Back
                </Button>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={gateBusy}
                  onClick={(e) => {
                    e.preventDefault();
                    void handleGateDeleteAndStart();
                  }}
                >
                  {gateBusy ? 'Removing…' : 'Delete Draft'}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
