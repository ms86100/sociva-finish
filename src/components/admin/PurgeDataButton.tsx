// @ts-nocheck
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, Loader2, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface PurgeResult {
  success: boolean;
  duration_ms?: number;
  error?: string;
  summary?: {
    admins_preserved: number;
    users_deleted: number;
    tables_cleaned: number;
    details: Record<string, number>;
  };
}

export function PurgeDataButton() {
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PurgeResult | null>(null);

  const handlePurge = async () => {
    setIsRunning(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('purge-non-admin-data', { method: 'POST' });
      if (error) throw error;
      setResult(data as PurgeResult);
      if (data?.success) {
        toast.success(`Purge complete! ${data.summary?.users_deleted} users removed, ${data.summary?.admins_preserved} admin(s) preserved.`);
      } else {
        toast.error(`Purge failed: ${data?.error}`);
      }
    } catch (err: any) {
      const msg = err?.message || 'Unknown error';
      setResult({ success: false, error: msg });
      toast.error(`Purge error: ${msg}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <Card className="border-destructive/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trash2 className="h-4 w-4" />
          Purge All Non-Admin Data
        </CardTitle>
        <CardDescription className="text-xs">
          Deletes all users (except admin), orders, products, sellers, and transactional data. Preserves master configuration, categories, attribute library, and admin account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" disabled={isRunning} className="w-full">
              {isRunning ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Purging data...</>
              ) : (
                <><Trash2 className="h-4 w-4 mr-2" />Purge All User Data</>
              )}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-destructive" />
                Purge All Non-Admin Data?
              </AlertDialogTitle>
              <AlertDialogDescription className="space-y-2">
                <p>This will <strong>permanently delete</strong> all non-admin users, their profiles, seller accounts, products, orders, notifications, and all transactional data.</p>
                <p className="font-medium">Preserved: Admin account, system settings, category config, attribute blocks, societies, feature packages.</p>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handlePurge} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                Yes, Purge Everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {result && (
          <Card className={result.success ? 'border-success/30 bg-success/5' : 'border-destructive/30 bg-destructive/5'}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-center gap-2">
                {result.success ? <CheckCircle2 className="h-4 w-4 text-success" /> : <XCircle className="h-4 w-4 text-destructive" />}
                <span className="text-sm font-medium">{result.success ? 'Purge Complete' : 'Purge Failed'}</span>
                {result.duration_ms && (
                  <Badge variant="secondary" className="text-xs ml-auto">{(result.duration_ms / 1000).toFixed(1)}s</Badge>
                )}
              </div>
              {result.summary && (
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div className="text-center p-1.5 bg-background rounded">
                    <p className="font-bold">{result.summary.admins_preserved}</p>
                    <p className="text-muted-foreground">Admins Kept</p>
                  </div>
                  <div className="text-center p-1.5 bg-background rounded">
                    <p className="font-bold">{result.summary.users_deleted}</p>
                    <p className="text-muted-foreground">Users Deleted</p>
                  </div>
                  <div className="text-center p-1.5 bg-background rounded">
                    <p className="font-bold">{result.summary.tables_cleaned}</p>
                    <p className="text-muted-foreground">Tables Cleaned</p>
                  </div>
                </div>
              )}
              {result.error && <p className="text-xs text-destructive">{result.error}</p>}
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
