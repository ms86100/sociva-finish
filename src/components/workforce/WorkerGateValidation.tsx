// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { escapeIlike } from '@/lib/query-utils';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Search, CheckCircle, XCircle, Shield, AlertTriangle, Star, Clock, Home } from 'lucide-react';

interface ValidationResult {
  valid: boolean;
  reason?: string;
  worker_name?: string;
  worker_type?: string;
  photo_url?: string;
  rating?: number;
  flat_count?: number;
  flats?: { flat: string }[];
  entry_type?: string;
  requires_approval?: boolean;
  status?: string;
  suspension_reason?: string;
}

export function WorkerGateValidation() {
  const { user, effectiveSocietyId } = useAuth();
  const [searchInput, setSearchInput] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<any[]>([]);

  const handleSearch = async () => {
    if (!searchInput.trim() || !effectiveSocietyId) return;
    setIsValidating(true);
    setResult(null);

    // Escape ILIKE special characters
    const escaped = escapeIlike(searchInput);
    // Search workers by name or phone
    const { data } = await supabase
      .from('society_workers')
      .select('*')
      .eq('society_id', effectiveSocietyId)
      .or(`skills->name.ilike.%${escaped}%,skills->phone.ilike.%${escaped}%`)
      .limit(10);

    setSearchResults(data || []);
    setIsValidating(false);
  };

  const validateWorker = async (workerId: string) => {
    if (!effectiveSocietyId) return;
    setIsValidating(true);
    setSelectedWorkerId(workerId);

    const { data, error } = await supabase.rpc('validate_worker_entry', {
      _worker_id: workerId,
      _society_id: effectiveSocietyId,
    });

    if (error) {
      toast.error('Validation failed');
      setResult({ valid: false, reason: error.message });
    } else {
      setResult(data as unknown as ValidationResult);
    }
    setIsValidating(false);
  };

  const logEntry = async (allowed: boolean) => {
    if (!selectedWorkerId || !effectiveSocietyId || !user) return;

    // Log entry
    await supabase.from('worker_entry_logs').insert({
      worker_id: selectedWorkerId,
      society_id: effectiveSocietyId,
      validation_result: allowed ? 'allowed' : 'denied',
      denial_reason: allowed ? null : result?.reason,
      verified_by: user.id,
    });

    // Also create gate_entry
    await supabase.from('gate_entries').insert({
      society_id: effectiveSocietyId,
      user_id: user.id,
      entry_type: 'worker',
      notes: `Worker: ${result?.worker_name || 'Unknown'} - ${allowed ? 'Allowed' : 'Denied'}`,
      verified_by: user.id,
    });

    toast.success(allowed ? 'Worker entry allowed' : 'Worker entry denied');
    setResult(null);
    setSelectedWorkerId(null);
    setSearchInput('');
    setSearchResults([]);
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-primary/30">
        <CardContent className="p-4 space-y-3">
          <div className="text-center">
            <Shield className="mx-auto text-primary mb-1" size={32} />
            <h3 className="font-bold">Worker Verification</h3>
            <p className="text-xs text-muted-foreground">Search by name or phone number</p>
          </div>

          <div className="flex gap-2">
            <Input
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Worker name or phone..."
              className="text-lg h-12"
              onKeyDown={e => e.key === 'Enter' && handleSearch()}
            />
            <Button onClick={handleSearch} disabled={isValidating} className="h-12 px-6">
              <Search size={18} />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Search Results */}
      {searchResults.length > 0 && !result && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">{searchResults.length} worker(s) found</p>
          {searchResults.map(w => (
            <Card key={w.id} className="cursor-pointer hover:border-primary/50 transition-colors" onClick={() => validateWorker(w.id)}>
              <CardContent className="p-3 flex items-center gap-3">
                <Avatar className="h-12 w-12 rounded-lg">
                  <AvatarImage src={w.photo_url} className="object-cover" />
                  <AvatarFallback className="rounded-lg">{(w.skills?.name || '?')[0]}</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="font-semibold text-sm">{w.skills?.name || w.worker_type}</p>
                  <p className="text-xs text-muted-foreground capitalize">{w.worker_type}</p>
                </div>
                <Button size="sm" variant="outline">Validate</Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Validation Result */}
      {result && (
        <Card className={`border-2 ${result.valid ? 'border-success/50 bg-success/5' : 'border-destructive/50 bg-destructive/5'}`}>
          <CardContent className="p-4 space-y-3">
            <div className="text-center">
              {result.valid ? (
                <CheckCircle className="mx-auto text-success mb-1" size={40} />
              ) : (
                <XCircle className="mx-auto text-destructive mb-1" size={40} />
              )}
              <p className={`font-bold text-lg ${result.valid ? 'text-success' : 'text-destructive'}`}>
                {result.valid ? 'VALID — Entry Allowed' : 'ENTRY BLOCKED'}
              </p>
            </div>

            {result.valid && (
              <div className="bg-background rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{result.worker_name}</p>
                  <Badge variant="outline" className="capitalize text-[10px]">{result.worker_type}</Badge>
                </div>
                {result.rating && result.rating > 0 && (
                  <p className="text-xs flex items-center gap-1">
                    <Star size={10} className="text-warning fill-warning" />
                    {result.rating} rating
                  </p>
                )}
                {result.flats && (
                  <div className="flex items-center gap-1 flex-wrap">
                    <Home size={10} className="text-muted-foreground" />
                    {result.flats.map((f, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">Flat {f.flat}</Badge>
                    ))}
                  </div>
                )}
                {result.requires_approval && (
                  <Badge className="bg-warning/15 text-warning text-[10px]">
                    <AlertTriangle size={10} className="mr-1" /> Per-visit approval required
                  </Badge>
                )}
              </div>
            )}

            {!result.valid && (
              <div className="bg-background rounded-lg p-3">
                <p className="text-sm font-medium text-destructive">{result.reason}</p>
                {result.suspension_reason && (
                  <p className="text-xs text-muted-foreground mt-1">Reason: {result.suspension_reason}</p>
                )}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Button variant="destructive" size="lg" className="h-12" onClick={() => logEntry(false)}>
                <XCircle size={18} className="mr-2" /> Deny
              </Button>
              <Button
                variant="default"
                size="lg"
                className="h-12"
                onClick={() => logEntry(true)}
                disabled={!result.valid && result.status === 'blacklisted'}
              >
                <CheckCircle size={18} className="mr-2" /> Allow
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
