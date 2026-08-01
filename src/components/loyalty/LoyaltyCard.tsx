// @ts-nocheck
import { useLoyaltyBalance, useLoyaltyHistory } from '@/hooks/queries/useLoyalty';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Gift, TrendingUp, Star, ShoppingBag, ArrowDown, ArrowUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { format } from 'date-fns';
import { useState } from 'react';

export function LoyaltyCard() {
  const { data: balance, isLoading } = useLoyaltyBalance();
  const { data: history = [] } = useLoyaltyHistory(10);
  const [showHistory, setShowHistory] = useState(false);

  if (isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (balance === undefined || balance === null) return null;

  const sourceIcon = (source: string) => {
    switch (source) {
      case 'order': return <ShoppingBag size={12} />;
      case 'review': return <Star size={12} />;
      case 'signup': case 'bonus': return <Gift size={12} />;
      default: return <TrendingUp size={12} />;
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mb-3">
      <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-2">
              <Gift size={18} className="text-primary" />
              <span className="text-sm font-semibold">Loyalty Points</span>
            </div>
            <button
              onClick={() => setShowHistory(!showHistory)}
              className="text-[10px] text-primary font-medium"
            >
              {showHistory ? 'Hide' : 'History'}
            </button>
          </div>

          <div className="flex items-baseline gap-1.5">
            <span className="text-3xl font-bold text-primary">{balance}</span>
            <span className="text-xs text-muted-foreground">points</span>
            <Badge variant="outline" className="ml-auto text-[10px] border-primary/30 text-primary">
              = ₹{balance} off
            </Badge>
          </div>

          <p className="text-[10px] text-muted-foreground mt-1">
            Earn 1 point per ₹10 spent · +10 bonus for reviews
          </p>

          {/* Transaction History */}
          {showHistory && history.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border space-y-1.5">
              {history.map((tx) => (
                <div key={tx.id} className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className={tx.points > 0 ? 'text-success' : 'text-destructive'}>
                      {tx.points > 0 ? <ArrowUp size={10} /> : <ArrowDown size={10} />}
                    </span>
                    {sourceIcon(tx.source)}
                    <span className="truncate max-w-[160px]">{tx.description}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-semibold ${tx.points > 0 ? 'text-success' : 'text-destructive'}`}>
                      {tx.points > 0 ? '+' : ''}{tx.points}
                    </span>
                    <span className="text-[9px] text-muted-foreground">
                      {format(new Date(tx.created_at), 'MMM d')}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
