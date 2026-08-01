// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, Database, Loader2, CheckCircle2, XCircle, RefreshCw } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';

interface SeedResult {
  success: boolean;
  run_id?: string;
  duration_ms?: number;
  error?: string;
  summary?: {
    societies: number;
    sellers: number;
    buyers: number;
    products: number;
    products_with_specs: number;
    admin_preserved: number;
    test_results_saved: number;
    credentials?: {
      password: string;
      buyers: string[];
      sellers: string[];
    };
  };
}

export function ResetAndSeedButton() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<SeedResult | null>(null);
  const navigate = useNavigate();

  const handleRunSeed = async () => {
    setIsRunning(true);
    setResult(null);

    try {
      const { data, error } = await supabase.functions.invoke('reset-and-seed-scenario', {
        method: 'POST',
      });

      if (error) throw error;

      setResult(data as SeedResult);

      if (data?.success) {
        toast.success(`Seed completed! ${data.summary?.products} products across ${data.summary?.sellers} sellers`);
      } else {
        toast.error(`Seed failed: ${data?.error}`);
      }
    } catch (err: any) {
      const errorMsg = err?.message || 'Unknown error';
      setResult({ success: false, error: errorMsg });
      toast.error(`Seed error: ${errorMsg}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="h-4 w-4" />
          Reset & Seed Scenario Data
        </CardTitle>
        <CardDescription className="text-xs">
          Purges all user/listing data (preserves admin + config), then seeds Food, Coaching, Yoga & Electronics categories with sellers, products, and buyers.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              size="sm"
              disabled={isRunning}
              className="w-full"
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Running seed...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Reset & Seed Database
                </>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Reset & Seed Database?
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>This will <strong>permanently delete</strong> all user accounts, listings, orders, and related data.</p>
                <p className="font-medium">Preserved: Admin account, system settings, category config, attribute blocks.</p>
                <p>New test data will be seeded with 4 categories, 9 sellers, 3 buyers, and 40+ products.</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleRunSeed} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Yes, Reset & Seed
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {result && (
          <Card className={result.success ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                {result.success ? (
                  <CheckCircle2 className="h-4 w-4 text-success" />
                ) : (
                  <XCircle className="h-4 w-4 text-destructive" />
                )}
                <span className="text-sm font-medium">
                  {result.success ? 'Seed Completed Successfully' : 'Seed Failed'}
                </span>
                {result.duration_ms && (
                  <Badge variant="secondary" className="text-xs ml-auto">
                    {(result.duration_ms / 1000).toFixed(1)}s
                  </Badge>
                )}
              </div>

              {result.summary && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center p-1.5 bg-background rounded">
                    <p className="font-bold">{result.summary.societies}</p>
                    <p className="text-muted-foreground">Societies</p>
                  </div>
                  <div className="text-center p-1.5 bg-background rounded">
                    <p className="font-bold">{result.summary.sellers}</p>
                    <p className="text-muted-foreground">Sellers</p>
                  </div>
                  <div className="text-center p-1.5 bg-background rounded">
                    <p className="font-bold">{result.summary.products}</p>
                    <p className="text-muted-foreground">Products</p>
                  </div>
                </div>
              )}

              {result.error && (
                <p className="text-xs text-destructive">{result.error}</p>
              )}

              {result.run_id && (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => navigate('/test-results')}
                >
                  View Detailed Results →
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
