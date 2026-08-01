// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Share2, Copy, Check } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';

export function ShareMyStore() {
  const { currentSellerId, sellerProfiles } = useAuth();
  const [copied, setCopied] = useState(false);

  const activeSellerId = currentSellerId || sellerProfiles?.[0]?.id;
  const activeProfile = sellerProfiles?.find(p => p.id === activeSellerId);

  if (!activeSellerId || !activeProfile) return null;

  const storeUrl = `${window.location.origin}/#/seller/${activeSellerId}`;
  const shareText = `Check out ${activeProfile.business_name} on Sociva! 🛍️\n${storeUrl}`;

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: activeProfile.business_name,
          text: `Check out ${activeProfile.business_name} on Sociva! 🛍️`,
          url: storeUrl,
        });
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          fallbackCopy();
        }
      }
    } else {
      fallbackCopy();
    }
  };

  const fallbackCopy = async () => {
    try {
      await navigator.clipboard.writeText(shareText);
      setCopied(true);
      toast.success('Store link copied to clipboard!');
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
          <Button size="sm" className="h-8 gap-1.5" onClick={handleShare}>
            <Share2 size={14} />
            Share
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
