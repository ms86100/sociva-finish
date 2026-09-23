// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Share2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { resolveOperationalSellerId } from '@/lib/seller-order-board';
import { showFeedback } from '@/components/FeedbackPopupProvider';
import { displaySellerStoreName } from '@/lib/seller-journey';
import { buildStoreShareText, shareSocivaContent, storeShareUrl } from '@/lib/sociva-share';

export function ShareMyStore() {
  const { currentSellerId, sellerProfiles } = useAuth();
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const activeSellerId = resolveOperationalSellerId(currentSellerId, sellerProfiles || []);
  const activeProfile = sellerProfiles?.find(p => p.id === activeSellerId);

  if (!activeSellerId || !activeProfile) return null;

  const storeName = displaySellerStoreName(activeProfile.business_name);
  const shareUrl = storeShareUrl(activeSellerId);
  const shareText = buildStoreShareText({ storeName, url: shareUrl });

  const handleShare = async () => {
    if (sharing) return;
    setSharing(true);
    try {
      const result = await shareSocivaContent({
        title: storeName,
        text: shareText,
        url: shareUrl,
        imageUrl: activeProfile.cover_image_url || null,
      });
      if (result === 'shared' || result === 'whatsapp') {
        showFeedback({
          title: 'Ready to share',
          description: 'Pick an app to send your store',
          variant: 'success',
        });
      } else if (result === 'copied') {
        setCopied(true);
        showFeedback({
          title: 'Store link copied',
          description: 'Paste it in WhatsApp to share your store',
          variant: 'success',
        });
        setTimeout(() => setCopied(false), 2000);
      } else if (result === 'failed') {
        showFeedback({
          title: 'Could not share right now',
          description: 'Please try again in a moment',
          variant: 'warning',
        });
      }
    } finally {
      setSharing(false);
    }
  };

  const fallbackCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      showFeedback({
        title: 'Store link copied to clipboard!',
        variant: 'success',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  };

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-sm">Share Your Store</p>
          <p className="text-[10px] text-muted-foreground truncate">
            Send your store link via WhatsApp, Instagram or copy it
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 hidden md:inline-flex" onClick={fallbackCopy}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </Button>
          <Button size="sm" className="h-8 gap-1.5" onClick={handleShare} disabled={sharing}>
            <Share2 size={14} />
            Share
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
