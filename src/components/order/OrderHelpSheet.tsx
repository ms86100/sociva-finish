// @ts-nocheck
import { useState, useMemo, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer';
import { Textarea } from '@/components/ui/textarea';
import { HelpCircle, Clock, Package, CreditCard, MessageCircle, ChevronRight, Loader2, X, Camera, AlertTriangle, CheckCircle2, ArrowLeft, XCircle, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { computeETA } from '@/lib/etaEngine';
import { useEvaluateResolution, useCreateTicket, uploadEvidence } from '@/hooks/useSupportTickets';
import { supabase } from '@/integrations/supabase/client';
import { MultiImageCapture } from '@/components/ui/multi-image-capture';
import { useAuth } from '@/contexts/AuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import { cn, friendlyError } from '@/lib/utils';
import { notify } from '@/lib/notify';

interface OrderHelpSheetProps {
  orderId: string;
  orderStatus: string;
  paymentStatus?: string;
  estimatedDeliveryAt?: string | null;
  sellerId: string;
  sellerName?: string;
  societyId?: string | null;
  onChatOpen?: () => void;
}

type Step = 'diagnosis' | 'category' | 'subtype' | 'evidence' | 'summary' | 'resolution';

const ISSUE_CATEGORIES = [
  { id: 'late_delivery', icon: Clock, label: 'Order is late', description: 'Taking longer than expected' },
  { id: 'missing_item', icon: Package, label: 'Missing item', description: 'Received fewer items' },
  { id: 'wrong_item', icon: XCircle, label: 'Wrong item', description: 'Received incorrect items' },
  { id: 'payment_issue', icon: CreditCard, label: 'Payment issue', description: 'Problem with my payment' },
  { id: 'cancel_request', icon: X, label: 'Cancel order', description: 'I want to cancel this order' },
  { id: 'other', icon: HelpCircle, label: 'Other issue', description: 'Something else' },
];

const SUBTYPES: Record<string, { id: string; label: string }[]> = {
  missing_item: [
    { id: 'one_missing', label: 'One item missing' },
    { id: 'multiple_missing', label: 'Multiple items missing' },
    { id: 'all_missing', label: 'Entire order missing' },
  ],
  wrong_item: [
    { id: 'wrong_product', label: 'Completely wrong product' },
    { id: 'wrong_variant', label: 'Wrong size/variant' },
    { id: 'damaged', label: 'Item is damaged' },
  ],
  late_delivery: [
    { id: 'still_waiting', label: 'Still waiting' },
    { id: 'no_update', label: 'No status updates' },
  ],
};

const CANCELABLE_STATUSES = ['placed', 'confirmed', 'preparing'];
const EVIDENCE_CATEGORIES = ['wrong_item', 'missing_item'];
const PRE_DELIVERY_STATUSES = ['placed', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];
const POST_DELIVERY_STATUSES = ['delivered', 'completed'];

function getAvailableCategories(orderStatus: string, paymentStatus?: string) {
  const isPre = PRE_DELIVERY_STATUSES.includes(orderStatus);
  const isPost = POST_DELIVERY_STATUSES.includes(orderStatus);
  const isCancelable = CANCELABLE_STATUSES.includes(orderStatus);
  const isRefunded = orderStatus === 'refunded';

  return ISSUE_CATEGORIES.filter((c) => {
    switch (c.id) {
      case 'late_delivery': return isPre;
      case 'missing_item': return isPost;
      case 'wrong_item': return isPost;
      case 'cancel_request': return isCancelable;
      case 'payment_issue': return !isRefunded;
      case 'other': return true;
      default: return true;
    }
  });
}

export function OrderHelpSheet({
  orderId,
  orderStatus,
  paymentStatus,
  estimatedDeliveryAt,
  sellerId,
  sellerName,
  societyId,
  onChatOpen,
}: OrderHelpSheetProps) {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [step, setStep] = useState<Step>('diagnosis');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedSubtype, setSelectedSubtype] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [resolutionResult, setResolutionResult] = useState<any>(null);

  const evaluateResolution = useEvaluateResolution();
  const createTicket = useCreateTicket();

  // Instant diagnosis
  const diagnosis = useMemo(() => {
    const insights: { type: string; emoji: string; title: string; description: string; action?: string; category?: string }[] = [];
    const eta = computeETA(estimatedDeliveryAt || null);

    if (eta.isLate) {
      insights.push({
        type: 'delay',
        emoji: '⏰',
        title: `Order is running ~${eta.minutes === 0 ? 'a few' : eta.minutes} min late`,
        description: 'We can track it or resolve this for you',
        action: 'Report delay',
        category: 'late_delivery',
      });
    }

    if (CANCELABLE_STATUSES.includes(orderStatus)) {
      insights.push({
        type: 'cancel',
        emoji: '🔄',
        title: 'This order can still be cancelled',
        description: 'Cancel and get a full refund',
        action: 'Cancel order',
        category: 'cancel_request',
      });
    }

    if (paymentStatus === 'failed') {
      insights.push({
        type: 'payment',
        emoji: '💳',
        title: 'Payment issue detected',
        description: 'We can help resolve this payment problem',
        action: 'Fix payment',
        category: 'payment_issue',
      });
    }

    return insights;
  }, [orderStatus, paymentStatus, estimatedDeliveryAt]);

  const reset = useCallback(() => {
    setStep('diagnosis');
    setSelectedCategory(null);
    setSelectedSubtype(null);
    setDescription('');
    setEvidenceFiles([]);
    setEvidenceUrls([]);
    setResolutionResult(null);
  }, []);

  const handleOpen = (open: boolean) => {
    setIsOpen(open);
    if (open) reset();
  };

  const handleDiagnosisAction = (category: string) => {
    setSelectedCategory(category);
    const hasSubtypes = SUBTYPES[category];
    setStep(hasSubtypes ? 'subtype' : 'summary');
  };

  const handleCategorySelect = (categoryId: string) => {
    setSelectedCategory(categoryId);
    const hasSubtypes = SUBTYPES[categoryId];
    if (hasSubtypes) {
      setStep('subtype');
    } else if (EVIDENCE_CATEGORIES.includes(categoryId)) {
      setStep('evidence');
    } else {
      setStep('summary');
    }
  };

  const handleSubtypeSelect = (subtypeId: string) => {
    setSelectedSubtype(subtypeId);
    if (EVIDENCE_CATEGORIES.includes(selectedCategory!)) {
      setStep('evidence');
    } else {
      setStep('summary');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (evidenceFiles.length + files.length > 3) {
      toast.error('Maximum 3 images allowed');
      return;
    }
    const valid = files.filter(f => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
        toast.error(`${f.name}: Only JPEG, PNG, WebP allowed`);
        return false;
      }
      if (f.size > 5 * 1024 * 1024) {
        toast.error(`${f.name}: Max 5MB`);
        return false;
      }
      return true;
    });
    setEvidenceFiles(prev => [...prev, ...valid]);
  };

  const removeFile = (index: number) => {
    setEvidenceFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!user || !selectedCategory) return;

    setIsUploading(true);
    try {
      // Upload evidence
      let urls = evidenceUrls;
      if (evidenceFiles.length > 0) {
        const uploaded = await Promise.all(evidenceFiles.map(f => uploadEvidence(user.id, f)));
        urls = [...urls, ...uploaded];
        setEvidenceUrls(urls);
      }

      // Run rule engine FIRST
      const result = await evaluateResolution.mutateAsync({
        orderId,
        issueType: selectedCategory,
        issueSubtype: selectedSubtype || undefined,
      });

      if (result.resolved) {
        // Auto-resolved — no ticket needed
        setResolutionResult(result);
        setStep('resolution');
        return;
      }

      // Not resolved — create ticket via SECURITY DEFINER RPC.
      console.info('[Support] submit start', { orderId, issue_type: selectedCategory });

      const ticket = await createTicket.mutateAsync({
        order_id: orderId,
        buyer_id: user.id,
        seller_id: sellerId,
        society_id: societyId,
        issue_type: selectedCategory,
        issue_subtype: selectedSubtype,
        description: description || `Issue: ${selectedCategory.replace(/_/g, ' ')}`,
        evidence_urls: urls,
      });

      console.info('[Support] submit success', { orderId, ticket_id: (ticket as any)?.id });

      setResolutionResult({
        resolved: false,
        ticket,
        resolution_note: 'The seller has 2 hours to respond. We will notify you the moment they do.',
      });
      setStep('resolution');
    } catch (err: any) {
      console.warn('[Support] submit failure', { orderId, issue_type: selectedCategory, code: err?.code, message: err?.message });
      const msg = String(err?.message || '');
      if (msg.includes('seller_not_resolvable')) {
        toast.error("We couldn't reach this seller right now. Please try again or use chat.");
      } else if (msg.includes('not_order_owner') || msg.includes('order_not_found')) {
        toast.error('This order is not available.');
      } else if (msg.includes('not_authenticated')) {
        notify.block('Please sign in again to submit a request.');
      } else if (msg.includes('seller_resolution_failed')) {
        toast.error("We couldn't reach this seller. Please use chat.");
      } else if (msg.includes('idx_support_tickets_idempotent')) {
        notify.block('You already have an active ticket for this issue');
      } else if (msg.includes('permission denied') && msg.includes('support_tickets')) {
        notify.block('Please refresh the app and try again.');
      } else {
        toast.error(friendlyError(err) || 'Something went wrong');
      }
    } finally {
      setIsUploading(false);
    }
  };

  const currentCategoryLabel = ISSUE_CATEGORIES.find(c => c.id === selectedCategory)?.label || '';
  const currentSubtypeLabel = SUBTYPES[selectedCategory!]?.find(s => s.id === selectedSubtype)?.label || '';

  return (
    <Drawer open={isOpen} onOpenChange={handleOpen}>
      <DrawerTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <HelpCircle size={16} className="mr-2" />
          Need help?
        </Button>
      </DrawerTrigger>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="flex items-center gap-2">
          {step !== 'diagnosis' && step !== 'resolution' && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => {
                if (step === 'category') setStep('diagnosis');
                else if (step === 'subtype') setStep('category');
                else if (step === 'evidence') setStep(SUBTYPES[selectedCategory!] ? 'subtype' : 'category');
                else if (step === 'summary') setStep(EVIDENCE_CATEGORIES.includes(selectedCategory!) ? 'evidence' : (SUBTYPES[selectedCategory!] ? 'subtype' : 'category'));
              }}
            >
              <ArrowLeft size={16} />
            </Button>
          )}
          <DrawerTitle className="flex-1">
            {step === 'diagnosis' && 'Need help with this order?'}
            {step === 'category' && 'What went wrong?'}
            {step === 'subtype' && currentCategoryLabel}
            {step === 'evidence' && 'Add photos (optional)'}
            {step === 'summary' && 'Confirm your issue'}
            {step === 'resolution' && (resolutionResult?.resolved ? 'Issue resolved!' : 'Ticket created')}
          </DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-6 space-y-3 overflow-y-auto">
          <AnimatePresence mode="wait">
            {/* STEP: Diagnosis */}
            {step === 'diagnosis' && (
              <motion.div key="diagnosis" initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }} className="space-y-3">
                {diagnosis.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">We noticed</p>
                    {diagnosis.map((d) => (
                      <button
                        key={d.type}
                        onClick={() => handleDiagnosisAction(d.category!)}
                        className="w-full flex items-center gap-3 p-3.5 bg-warning/5 border border-warning/20 rounded-xl text-left transition-colors hover:bg-warning/10"
                      >
                        <span className="text-xl">{d.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold">{d.title}</p>
                          <p className="text-xs text-muted-foreground">{d.description}</p>
                        </div>
                        <ChevronRight size={16} className="text-muted-foreground shrink-0" />
                      </button>
                    ))}
                  </div>
                )}

                {onChatOpen && (
                  <button
                    onClick={() => { setIsOpen(false); onChatOpen(); }}
                    className="w-full flex items-center gap-3 p-3.5 bg-primary/5 rounded-xl text-left"
                  >
                    <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                      <MessageCircle className="text-primary" size={18} />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">Chat with {sellerName || 'Seller'}</p>
                      <p className="text-[11px] text-muted-foreground">Quick way to resolve most issues</p>
                    </div>
                    <ChevronRight size={16} className="text-muted-foreground" />
                  </button>
                )}

                <Button variant="outline" className="w-full" onClick={() => setStep('category')}>
                  Report a different issue
                </Button>
              </motion.div>
            )}

            {/* STEP: Category Selection (status-aware) */}
            {step === 'category' && (() => {
              const available = getAvailableCategories(orderStatus, paymentStatus);
              const onlyOther = available.length === 1 && available[0].id === 'other';
              return (
                <motion.div key="category" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-2">
                  {onlyOther && (
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3">
                      For status questions, chat with the seller is faster.
                    </p>
                  )}
                  {available.map(({ id, icon: Icon, label, description }) => (
                    <button
                      key={id}
                      onClick={() => handleCategorySelect(id)}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-xl border transition-colors text-left',
                        'border-border hover:bg-muted'
                      )}
                    >
                      <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                        <Icon size={18} className="text-muted-foreground" />
                      </div>
                      <div className="flex-1">
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-[11px] text-muted-foreground">{description}</p>
                      </div>
                      <ChevronRight size={14} className="text-muted-foreground" />
                    </button>
                  ))}
                </motion.div>
              );
            })()}

            {/* STEP: Subtype Selection */}
            {step === 'subtype' && selectedCategory && SUBTYPES[selectedCategory] && (
              <motion.div key="subtype" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-2">
                <p className="text-xs text-muted-foreground">Tell us more:</p>
                {SUBTYPES[selectedCategory].map(({ id, label }) => (
                  <button
                    key={id}
                    onClick={() => handleSubtypeSelect(id)}
                    className="w-full flex items-center justify-between p-3 rounded-xl border border-border hover:bg-muted text-left transition-colors"
                  >
                    <p className="text-sm font-medium">{label}</p>
                    <ChevronRight size={14} className="text-muted-foreground" />
                  </button>
                ))}
              </motion.div>
            )}

            {/* STEP: Evidence Upload — supports gallery, camera (capture=environment), and native picker */}
            {step === 'evidence' && (
              <motion.div key="evidence" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <p className="text-xs text-muted-foreground">Add photos to help us understand the issue (max 3, 5MB each)</p>

                <MultiImageCapture
                  value={evidenceUrls}
                  onChange={setEvidenceUrls}
                  pathPrefix="support-evidence"
                  max={3}
                />

                <Button className="w-full" onClick={() => setStep('summary')}>
                  {evidenceUrls.length > 0 ? 'Continue' : 'Skip'}
                </Button>
              </motion.div>
            )}

            {/* STEP: Summary */}
            {step === 'summary' && (
              <motion.div key="summary" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} className="space-y-3">
                <div className="bg-muted/50 rounded-xl p-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Issue</span>
                    <span className="text-xs font-medium">{currentCategoryLabel}</span>
                  </div>
                  {currentSubtypeLabel && (
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Detail</span>
                      <span className="text-xs font-medium">{currentSubtypeLabel}</span>
                    </div>
                  )}
                  {evidenceFiles.length > 0 && (
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Photos</span>
                      <span className="text-xs font-medium">{evidenceFiles.length} attached</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-xs text-muted-foreground">Order</span>
                    <span className="text-xs font-mono">{orderId.slice(0, 8)}</span>
                  </div>
                </div>

                <Textarea
                  placeholder="Add details (optional)..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="text-sm"
                />

                <Button
                  className="w-full"
                  onClick={handleSubmit}
                  disabled={isUploading || evaluateResolution.isPending || createTicket.isPending}
                >
                  {(isUploading || evaluateResolution.isPending || createTicket.isPending) ? (
                    <><Loader2 className="animate-spin mr-2" size={16} />Processing...</>
                  ) : (
                    'Submit Issue'
                  )}
                </Button>
              </motion.div>
            )}

            {/* STEP: Resolution */}
            {step === 'resolution' && resolutionResult && (() => {
              const ticket = resolutionResult.ticket;
              const isActionResolved = resolutionResult.resolved && (
                resolutionResult.resolution_type === 'cancel_and_refund' ||
                resolutionResult.resolution_type === 'refund'
              );
              const isTicket = !resolutionResult.resolved && !!ticket;
              const slaDate = ticket?.sla_deadline ? new Date(ticket.sla_deadline) : null;
              const slaText = slaDate
                ? slaDate.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
                : null;
              const ticketShort = ticket?.id ? String(ticket.id).slice(0, 8).toUpperCase() : null;

              return (
                <motion.div key="resolution" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4 py-2">
                  <div className={cn(
                    'w-14 h-14 rounded-full mx-auto flex items-center justify-center',
                    isActionResolved ? 'bg-emerald-500/10' : 'bg-primary/10'
                  )}>
                    {isActionResolved ? (
                      <CheckCircle2 className="text-emerald-500" size={28} />
                    ) : (
                      <ShieldAlert className="text-primary" size={28} />
                    )}
                  </div>

                  {isTicket && (
                    <div className="text-center space-y-1">
                      <p className="text-base font-bold">We've alerted the seller</p>
                      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                        {sellerName ? `${sellerName} has been notified.` : 'The seller has been notified.'} We'll let you know as soon as they respond.
                      </p>
                    </div>
                  )}

                  {isActionResolved && (
                    <div className="text-center space-y-1">
                      <p className="text-base font-bold">
                        {resolutionResult.resolution_type === 'cancel_and_refund' ? 'Done — order cancelled, refund initiated' : 'Done — refund initiated'}
                      </p>
                      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                        {resolutionResult.resolution_note || 'Your refund will be credited to your original payment method in 3-5 business days.'}
                      </p>
                    </div>
                  )}

                  {!isTicket && !isActionResolved && (
                    <div className="text-center space-y-1">
                      <p className="text-base font-bold">Request received</p>
                      <p className="text-sm text-muted-foreground max-w-xs mx-auto">
                        {resolutionResult.resolution_note}
                      </p>
                    </div>
                  )}

                  {isTicket && (ticketShort || slaText) && (
                    <div className="bg-muted/50 rounded-xl p-3 space-y-2">
                      {ticketShort && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">Ticket</span>
                          <span className="text-xs font-mono font-medium">#{ticketShort}</span>
                        </div>
                      )}
                      {slaText && (
                        <div className="flex justify-between items-center">
                          <span className="text-xs text-muted-foreground">Response expected by</span>
                          <span className="text-xs font-medium">{slaText}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="space-y-2">
                    {isTicket && onChatOpen && (
                      <Button
                        className="w-full"
                        onClick={() => { setIsOpen(false); onChatOpen(); }}
                      >
                        <MessageCircle size={16} className="mr-2" />
                        Message seller now
                      </Button>
                    )}
                    <Button variant="outline" className="w-full" onClick={() => setIsOpen(false)}>
                      Done
                    </Button>
                  </div>
                </motion.div>
              );
            })()}

          </AnimatePresence>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
