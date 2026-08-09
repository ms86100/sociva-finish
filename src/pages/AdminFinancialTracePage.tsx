import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Search, ShieldAlert } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { SafeHeader } from '@/components/layout/SafeHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';

type TraceResult = Record<string, unknown>;
type RpcResult = { data: unknown; error: { message: string } | null };

const traceRpc = supabase.rpc as unknown as (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<RpcResult>;

export default function AdminFinancialTracePage() {
  const [reference, setReference] = useState('');
  const [trace, setTrace] = useState<TraceResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const runTrace = async (event: FormEvent) => {
    event.preventDefault();
    const value = reference.trim();
    if (!value) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: rpcError } = await traceRpc(
        'get_admin_financial_trace',
        { p_reference: value },
      );
      if (rpcError) throw new Error(rpcError.message);
      setTrace((data || {}) as TraceResult);
    } catch (caught) {
      setTrace(null);
      setError(caught instanceof Error ? caught.message : 'Trace lookup failed');
    } finally {
      setLoading(false);
    }
  };

  const sections = trace
    ? Object.entries(trace).filter(
        ([key, value]) => key !== 'reference' && key !== 'generated_at' && Array.isArray(value),
      )
    : [];

  return (
    <AppLayout showHeader={false} safeTop={false}>
      <SafeHeader>
        <div className="px-4 pb-3 flex items-center gap-3">
          <Link
            to="/admin"
            className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted"
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-xl font-bold">Financial Trace</h1>
            <p className="text-xs text-muted-foreground">Follow one reference across every money record</p>
          </div>
        </div>
      </SafeHeader>

      <div className="p-4 space-y-4">
        <form onSubmit={runTrace} className="flex gap-2">
          <Input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="Order, payment, refund, transfer, or journal ID"
            aria-label="Financial reference"
          />
          <Button type="submit" disabled={loading || !reference.trim()}>
            <Search size={16} className="mr-1.5" />
            {loading ? 'Tracing…' : 'Trace'}
          </Button>
        </form>

        <div className="rounded-xl border border-warning/30 bg-warning/10 p-3 flex gap-2">
          <ShieldAlert size={18} className="text-warning shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground">
            Read-only admin evidence. Corrections require a separate maker-checker adjustment and
            create a reversing journal; this screen never edits financial records.
          </p>
        </div>

        {error && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {trace && sections.length === 0 && (
          <div className="rounded-xl bg-muted p-6 text-center text-sm text-muted-foreground">
            No exact financial records matched this reference.
          </div>
        )}

        {sections.map(([name, value]) => {
          const records = value as unknown[];
          if (records.length === 0) return null;
          return (
            <Card key={name}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm capitalize">
                  {name.split('_').join(' ')} · {records.length}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {records.map((record, index) => (
                  <pre
                    key={`${name}-${index}`}
                    className="overflow-x-auto rounded-lg bg-muted p-3 text-[11px] leading-relaxed"
                  >
                    {JSON.stringify(record, null, 2)}
                  </pre>
                ))}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppLayout>
  );
}
