// @ts-nocheck
import { motion } from 'framer-motion';
import { Home, ShoppingBag } from 'lucide-react';
import { useArrivalDetection } from '@/hooks/useArrivalDetection';
import { useOrderSuggestions } from '@/hooks/useOrderSuggestions';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';

export function ArrivalSuggestionCard() {
  const { isNearHome } = useArrivalDetection();
  const { data: suggestions } = useOrderSuggestions();
  const navigate = useNavigate();

  // Only show when user just arrived home and has suggestions
  if (!isNearHome || !suggestions || suggestions.length === 0) return null;

  const topSuggestion = suggestions[0];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="mx-4 mt-3 rounded-2xl bg-gradient-to-br from-primary/8 to-accent/5 border border-primary/15 p-4"
    >
      <div className="flex items-center gap-2 mb-2">
        <Home size={16} className="text-primary" />
        <p className="text-xs font-semibold text-primary">Welcome home!</p>
      </div>
      <p className="text-sm text-foreground font-medium">
        Would you like to order {topSuggestion.product?.name || 'something'}?
      </p>
      <p className="text-xs text-muted-foreground mt-0.5">
        From {topSuggestion.seller?.business_name || 'your favourite seller'}
      </p>
      <div className="flex gap-2 mt-3">
        <Button size="sm" className="gap-1.5" onClick={() => navigate(`/product/${topSuggestion.product_id}`)}>
          <ShoppingBag size={14} />
          Order Now
        </Button>
        <Button size="sm" variant="ghost" onClick={() => navigate('/marketplace')}>
          Browse
        </Button>
      </div>
    </motion.div>
  );
}
