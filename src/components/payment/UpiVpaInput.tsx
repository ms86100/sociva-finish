import { useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { useUpiValidation, type UpiValidationStatus } from '@/hooks/useUpiValidation';
import { cn } from '@/lib/utils';

interface UpiVpaInputProps {
  value: string;
  onChange: (v: string) => void;
  sellerId?: string;
  businessName?: string;
  initialStatus?: UpiValidationStatus;
  initialHolderName?: string | null;
  initialProvider?: string | null;
  initialVerifiedAt?: string | null;
  placeholder?: string;
  disabled?: boolean;
  onStatusChange?: (status: UpiValidationStatus, holderName?: string) => void;
}

const STALE_DAYS = 30;

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  return dp[m][n];
}

function namesSimilar(a?: string, b?: string): boolean {
  if (!a || !b) return true;
  const A = a.toLowerCase().replace(/[^a-z]/g, '');
  const B = b.toLowerCase().replace(/[^a-z]/g, '');
  if (!A || !B) return true;
  if (A.includes(B) || B.includes(A)) return true;
  const dist = levenshtein(A, B);
  const maxLen = Math.max(A.length, B.length);
  return dist / maxLen <= 0.4;
}

export function UpiVpaInput({
  value, onChange, sellerId, businessName,
  initialStatus, initialHolderName, initialProvider, initialVerifiedAt,
  placeholder = 'yourname@bank', disabled, onStatusChange,
}: UpiVpaInputProps) {
  // Derive stale from initial
  const computedInitial = useMemo<UpiValidationStatus | undefined>(() => {
    if (initialStatus === 'valid' && initialVerifiedAt) {
      const ageMs = Date.now() - new Date(initialVerifiedAt).getTime();
      if (ageMs > STALE_DAYS * 24 * 60 * 60 * 1000) return 'stale';
    }
    return initialStatus;
  }, [initialStatus, initialVerifiedAt]);

  const { status, customerName, provider, reason, validate, reset } = useUpiValidation({
    sellerId,
    initialStatus: computedInitial,
    initialHolderName,
    initialProvider,
  });

  useEffect(() => { onStatusChange?.(status, customerName); }, [status, customerName, onStatusChange]);

  const handleChange = (v: string) => {
    onChange(v);
    if (!v.trim()) { reset(); return; }
    // Reset to checking visually
    validate(v);
  };

  const reverify = () => validate(value, true);

  const showMismatch = status === 'valid' && customerName && businessName && !namesSimilar(customerName, businessName);

  return (
    <div className="space-y-2">
      <div className="relative">
        <Input
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            'pr-10',
            status === 'valid' && 'border-green-500 focus-visible:ring-green-500',
            status === 'invalid' && 'border-destructive focus-visible:ring-destructive',
            (status === 'unavailable' || status === 'error' || status === 'stale') && 'border-amber-500 focus-visible:ring-amber-500',
          )}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {status === 'checking' && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {status === 'valid' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
          {status === 'invalid' && <XCircle className="h-4 w-4 text-destructive" />}
          {(status === 'unavailable' || status === 'error' || status === 'stale') && <AlertTriangle className="h-4 w-4 text-amber-600" />}
        </div>
      </div>

      {status === 'valid' && customerName && (
        <div className="flex items-center gap-2 text-sm">
          <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
          <span className="text-foreground">Verified: <strong>{customerName}</strong></span>
          {provider && <Badge variant="outline" className="text-xs">{provider}</Badge>}
        </div>
      )}

      {status === 'invalid' && (
        <p className="text-sm text-destructive">{reason || 'Invalid UPI ID'}</p>
      )}

      {(status === 'unavailable' || status === 'error') && (
        <div className="flex items-start justify-between gap-2 text-sm">
          <p className="text-amber-600">{reason || 'Could not verify UPI right now.'}</p>
          <Button type="button" size="sm" variant="ghost" onClick={reverify} className="h-7 text-amber-700">
            <RefreshCw className="h-3 w-3 mr-1" /> Retry
          </Button>
        </div>
      )}

      {status === 'stale' && (
        <div className="flex items-start justify-between gap-2 text-sm">
          <p className="text-amber-600">Verification is older than {STALE_DAYS} days. Please re-verify.</p>
          <Button type="button" size="sm" variant="ghost" onClick={reverify} className="h-7 text-amber-700">
            <RefreshCw className="h-3 w-3 mr-1" /> Re-verify
          </Button>
        </div>
      )}

      {showMismatch && (
        <p className="text-xs text-amber-600">
          Note: holder name "{customerName}" doesn't closely match your business name "{businessName}". This is allowed but buyers may see a mismatch warning.
        </p>
      )}
    </div>
  );
}
