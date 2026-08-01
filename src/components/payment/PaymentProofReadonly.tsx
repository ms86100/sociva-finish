// @ts-nocheck
import { useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ImageIcon } from 'lucide-react';

interface PaymentProofReadonlyProps {
  screenshotUrl: string;
  utrRef?: string | null;
}

export function PaymentProofReadonly({ screenshotUrl, utrRef }: PaymentProofReadonlyProps) {
  const [showFullImage, setShowFullImage] = useState(false);

  return (
    <>
      <div className="bg-card border border-border rounded-xl p-4 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
          <ImageIcon size={12} /> Payment Proof
        </p>
        {utrRef && (
          <div className="bg-muted/50 rounded-lg px-3 py-2">
            <p className="text-[11px] text-muted-foreground uppercase tracking-wide">Transaction ID (UTR)</p>
            <p className="text-sm font-mono font-semibold mt-0.5">{utrRef}</p>
          </div>
        )}
        <button
          onClick={() => setShowFullImage(true)}
          className="block rounded-lg overflow-hidden border border-border hover:border-primary/40 transition-colors w-full"
        >
          <img
            src={screenshotUrl}
            alt="Payment screenshot"
            className="w-full max-h-40 object-cover bg-muted/30"
          />
        </button>
      </div>

      <Dialog open={showFullImage} onOpenChange={setShowFullImage}>
        <DialogContent className="sm:max-w-lg p-2">
          <img
            src={screenshotUrl}
            alt="Payment screenshot"
            className="w-full rounded-xl object-contain max-h-[70vh]"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
