import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SocivaVoiceCall } from '@/components/seller/SocivaVoiceCall';
import { useSocivaVoiceCall } from '@/hooks/useSocivaVoiceCall';
import { DEFAULT_SOCIVA_VOICE_SOCIETY, validateSocivaVoiceLead } from '@/lib/sociva-voice-lead';

export default function TalkToSocivaPage() {
  const voice = useSocivaVoiceCall();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [societyName, setSocietyName] = useState(DEFAULT_SOCIVA_VOICE_SOCIETY);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const inCall = voice.status === 'starting' || voice.status === 'connecting' || voice.status === 'live' || voice.status === 'agent_speaking';
  const showThanks = voice.status === 'ended';

  const canSubmit = useMemo(() => {
    const parsed = validateSocivaVoiceLead({
      full_name: fullName,
      phone,
      society_name: societyName,
    });
    return parsed.ok && !inCall;
  }, [fullName, phone, societyName, inCall]);

  const handleStart = async (event: FormEvent) => {
    event.preventDefault();
    const parsed = validateSocivaVoiceLead({
      full_name: fullName,
      phone,
      society_name: societyName,
    });
    if (!parsed.ok) {
      setFormErrors(parsed.errors as Record<string, string>);
      return;
    }
    setFormErrors({});
    await voice.startCall(parsed.value!);
  };

  return (
    <AppLayout headerTitle="Talk to Sociva" showLocation={false} showNav={false} showCart={false} showBack>
      <div className="max-w-md mx-auto px-4 py-6">
        {inCall || (voice.status === 'error' && voice.callId) ? (
          <>
            <SocivaVoiceCall
              status={voice.status}
              muted={voice.muted}
              error={voice.error}
              onToggleMute={voice.toggleMute}
              onEnd={() => void voice.endCall()}
            />
            {voice.status === 'error' && (
              <Button className="w-full rounded-xl h-11 mt-2" onClick={voice.reset}>
                Try again
              </Button>
            )}
          </>
        ) : showThanks ? (
          <div className="text-center py-10">
            <img src="/logo.png" alt="Sociva" className="h-10 w-auto mx-auto mb-6" />
            <h1 className="text-xl font-bold">Thank you</h1>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
              Sociva's team will review what you shared and set up your store. We may call or message you on the number you provided.
            </p>
            <Button asChild className="mt-8 rounded-xl h-11 w-full">
              <Link to="/">Back to Sociva</Link>
            </Button>
            <button
              type="button"
              className="mt-4 text-sm text-muted-foreground underline"
              onClick={voice.reset}
            >
              Start another conversation
            </button>
          </div>
        ) : (
          <>
            <div className="mb-6">
              <img src="/logo.png" alt="Sociva" className="h-9 w-auto mb-4" />
              <h1 className="text-2xl font-extrabold tracking-tight">Talk to Sociva</h1>
              <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                Speak in English, Hindi, or Kannada - whichever feels natural. Share freely about what you sell. Sociva will listen, then our team sets up your store. You do not need an account.
              </p>
            </div>

            <form className="space-y-4" onSubmit={handleStart}>
              <div className="space-y-1.5">
                <Label htmlFor="sociva-voice-name">Your name</Label>
                <Input
                  id="sociva-voice-name"
                  autoComplete="name"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="h-12 rounded-xl"
                  placeholder="For example, Anjali"
                />
                {formErrors.full_name && <p className="text-xs text-destructive">{formErrors.full_name}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sociva-voice-phone">Mobile number</Label>
                <Input
                  id="sociva-voice-phone"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                  maxLength={10}
                  className="h-12 rounded-xl"
                  placeholder="10-digit number"
                />
                {formErrors.phone && <p className="text-xs text-destructive">{formErrors.phone}</p>}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sociva-voice-society">Society</Label>
                <Input
                  id="sociva-voice-society"
                  value={societyName}
                  onChange={(e) => setSocietyName(e.target.value)}
                  className="h-12 rounded-xl"
                  placeholder="Shriram Greenfield"
                />
                {formErrors.society_name && <p className="text-xs text-destructive">{formErrors.society_name}</p>}
              </div>

              {voice.status === 'error' && voice.error && (
                <p className="text-sm text-destructive">{voice.error}</p>
              )}

              <Button type="submit" className="w-full h-12 rounded-xl font-semibold" disabled={!canSubmit}>
                Talk to Sociva
              </Button>
            </form>

            <p className="text-xs text-muted-foreground mt-6 leading-relaxed">
              Prefer to list it yourself? <Link to="/become-seller" className="text-primary font-semibold">Create a store in the app</Link>.
            </p>
          </>
        )}
      </div>
    </AppLayout>
  );
}
