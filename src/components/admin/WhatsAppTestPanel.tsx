import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, MessageCircle, Send } from 'lucide-react';
import { toast } from 'sonner';

type SendResult = {
  success?: boolean;
  code?: string;
  error?: string;
  meta?: unknown;
  metaMessageId?: string;
  elapsedMs?: number;
  httpStatus?: number;
};

function friendlyError(code?: string, fallback?: string) {
  switch (code) {
    case 'unauthorized':
      return 'Unauthorized — admin session required';
    case 'token_expired':
      return 'WhatsApp token expired — refresh WHATSAPP_ACCESS_TOKEN';
    case 'invalid_phone':
      return 'Invalid phone — use country code digits only (e.g. 9198XXXXXXXX)';
    case 'rate_limited':
      return 'Rate limited by Meta — wait and retry';
    case 'missing_credentials':
      return 'Missing WhatsApp credentials — set secrets or Admin → Credentials';
    case 'meta_error':
      return fallback || 'Meta API rejected the message';
    default:
      return fallback || 'Unexpected error sending WhatsApp';
  }
}

export function WhatsAppTestPanel() {
  const [phoneNumber, setPhoneNumber] = useState('91');
  const [message, setMessage] = useState('Hello from Sociva');
  const [sending, setSending] = useState(false);
  const [lastResult, setLastResult] = useState<SendResult | null>(null);

  const handleSend = async () => {
    setSending(true);
    setLastResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('send-whatsapp', {
        body: { phoneNumber, message, template: 'raw' },
      });

      if (error) {
        const payload = (data || {}) as SendResult;
        setLastResult({ success: false, code: 'unexpected', error: error.message, ...payload });
        toast.error(friendlyError(payload.code, error.message));
        return;
      }

      const result = (data || {}) as SendResult;
      setLastResult(result);
      if (result.success) {
        toast.success(`WhatsApp sent (${result.elapsedMs ?? '?'}ms)`);
      } else {
        toast.error(friendlyError(result.code, result.error));
      }
    } catch (e) {
      const msg = String(e);
      setLastResult({ success: false, code: 'unexpected', error: msg });
      toast.error(msg);
    } finally {
      setSending(false);
    }
  };

  return (
    <Card className="rounded-2xl border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-primary" />
          <CardTitle className="text-base">Send WhatsApp Test</CardTitle>
        </div>
        <CardDescription>
          Invokes <code className="text-xs">send-whatsapp</code> Edge Function via Meta Cloud API.
          Phone must include country code without +. Free-form text only works inside Meta&apos;s 24h window
          (or test numbers).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="wa-phone">Phone Number</Label>
          <Input
            id="wa-phone"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            placeholder="9198XXXXXXXX"
            className="rounded-xl"
            inputMode="numeric"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="wa-message">Message</Label>
          <Textarea
            id="wa-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="rounded-xl min-h-[88px]"
          />
        </div>
        <Button
          className="w-full rounded-xl h-11 font-semibold gap-2"
          onClick={handleSend}
          disabled={sending || !phoneNumber.trim() || !message.trim()}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </Button>

        {lastResult && (
          <div className="rounded-xl border border-border/50 bg-muted/40 p-3 space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant={lastResult.success ? 'default' : 'destructive'}>
                {lastResult.success ? 'Success' : lastResult.code || 'Failure'}
              </Badge>
              {typeof lastResult.elapsedMs === 'number' && (
                <span className="text-xs text-muted-foreground">{lastResult.elapsedMs}ms</span>
              )}
            </div>
            {lastResult.metaMessageId && (
              <p className="text-xs break-all">meta_message_id: {lastResult.metaMessageId}</p>
            )}
            {lastResult.error && <p className="text-xs text-destructive">{lastResult.error}</p>}
            {lastResult.meta != null && (
              <pre className="text-[10px] overflow-auto max-h-40 whitespace-pre-wrap break-all">
                {JSON.stringify(lastResult.meta, null, 2)}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
