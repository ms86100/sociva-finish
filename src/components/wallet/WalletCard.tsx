// @ts-nocheck
import { useBuyerWallet, useWalletHistory } from '@/hooks/queries/useWallet';
import { useFinancialCapabilities } from '@/hooks/useFinancialCapabilities';
import { resolveWalletCardMode } from '@/lib/buyer-balance-visibility';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet, ArrowDown, ArrowUp, AlertTriangle, Clock } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { useState } from 'react';

function formatInr(n: number) {
  return `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

export function WalletCard() {
  const { data: wallet, isLoading: walletLoading } = useBuyerWallet();
  const { onlinePaymentEnabled, isLoading: capsLoading } = useFinancialCapabilities();
  const { data: history = [] } = useWalletHistory(10);
  const [showHistory, setShowHistory] = useState(false);

  if (walletLoading || capsLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (!wallet) return null;

  const total = Number(wallet.total_available || 0);
  const frozen = wallet.status === 'frozen';
  const mode = resolveWalletCardMode({ balance: total, onlinePaymentEnabled });

  if (mode === 'hidden') return null;

  const readonly = mode === 'readonly';

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-3">
      <Card className="bg-gradient-to-r from-emerald-500/10 to-teal-500/5 border-emerald-500/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Wallet size={18} className="text-emerald-700" />
              <span className="text-sm font-semibold">Sociva Balance</span>
            </div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-[10px] text-emerald-700 font-medium"
              disabled={readonly}
            >
              {showHistory ? 'Hide' : 'History'}
            </button>
          </div>

          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold text-emerald-800">{formatInr(total)}</span>
            <Badge variant="outline" className="ml-auto text-[10px] border-emerald-500/30 text-emerald-800">
              Refund balance
            </Badge>
          </div>

          <div className="flex gap-3 mt-2 text-[11px] text-muted-foreground">
            <span>Cash {formatInr(wallet.cash_available)}</span>
            <span>Promo {formatInr(wallet.promo_available)}</span>
          </div>

          {wallet.nearest_promo_expires_at && (
            <p className="text-[10px] text-muted-foreground mt-1">
              Nearest promo expires {format(new Date(wallet.nearest_promo_expires_at), 'MMM d, yyyy')}
            </p>
          )}

          <p className="text-[10px] text-muted-foreground mt-1">
            {readonly
              ? 'Saved from refunds & promos · Usable when online payments return · Not withdrawable'
              : 'From refunds & promos · Usable on eligible online purchases · Not withdrawable'}
          </p>

          {readonly && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock size={12} />
              Online checkout is off — your balance is safe and will apply on future online orders.
            </div>
          )}

          {frozen && (
            <div className="mt-2 flex items-center gap-1.5 text-[11px] text-destructive">
              <AlertTriangle size={12} />
              Wallet frozen — contact support
            </div>
          )}

          {showHistory && !readonly && history.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border space-y-1.5">
              {history.map((tx) => {
                const amt = Number(tx.signed_amount || 0);
                return (
                  <div key={tx.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={amt >= 0 ? 'text-success' : 'text-destructive'}>
                        {amt >= 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                      </span>
                      <span className="truncate max-w-[180px]">{tx.description || tx.type}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`font-semibold ${amt >= 0 ? 'text-success' : 'text-destructive'}`}>
                        {amt >= 0 ? '+' : ''}{formatInr(amt)}
                      </span>
                      <span className="text-[9px] text-muted-foreground">
                        {format(new Date(tx.created_at), 'MMM d')}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {showHistory && history.length === 0 && (
            <p className="text-[11px] text-muted-foreground mt-3 pt-3 border-t">No credit activity yet.</p>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
