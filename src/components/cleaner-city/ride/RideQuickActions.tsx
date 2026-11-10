// @ts-nocheck
import { MessageCircle, Phone, Share2, Siren } from 'lucide-react';
import { cn } from '@/lib/utils';

type Props = {
  onCall?: () => void;
  onChat?: () => void;
  onShare?: () => void;
  onSos?: () => void;
  callBusy?: boolean;
  callAvailable?: boolean;
  shareBusy?: boolean;
  sosBusy?: boolean;
  className?: string;
};

const cell =
  'flex flex-1 flex-col items-center gap-1.5 rounded-2xl border border-black/5 bg-white px-2 py-3 text-[11px] font-semibold text-foreground transition active:scale-[0.98] disabled:opacity-50';

/** Mockup active-ride row: Call · Chat · Share · SOS */
export function RideQuickActions({
  onCall,
  onChat,
  onShare,
  onSos,
  callBusy,
  callAvailable = true,
  shareBusy,
  sosBusy,
  className,
}: Props) {
  return (
    <div
      className={cn('flex gap-2', className)}
      data-testid="cleaner-city-ride-quick-actions"
    >
      <button
        type="button"
        className={cell}
        onClick={onCall}
        disabled={!onCall || callBusy || !callAvailable}
        data-testid="cleaner-city-ride-action-call"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E8F2EC] text-[#0F3D2E]">
          <Phone className="h-4 w-4" />
        </span>
        Call
      </button>
      <button
        type="button"
        className={cell}
        onClick={onChat}
        disabled={!onChat}
        data-testid="cleaner-city-ride-action-chat"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E8F2EC] text-[#0F3D2E]">
          <MessageCircle className="h-4 w-4" />
        </span>
        Chat
      </button>
      <button
        type="button"
        className={cell}
        onClick={onShare}
        disabled={!onShare || shareBusy}
        data-testid="cleaner-city-ride-action-share"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#E8F2EC] text-[#0F3D2E]">
          <Share2 className="h-4 w-4" />
        </span>
        Share
      </button>
      <button
        type="button"
        className={cn(cell, 'text-[#8B1E1E]')}
        onClick={onSos}
        disabled={!onSos || sosBusy}
        data-testid="cleaner-city-ride-action-sos"
      >
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#F8E8E8] text-[#8B1E1E]">
          <Siren className="h-4 w-4" />
        </span>
        SOS
      </button>
    </div>
  );
}
