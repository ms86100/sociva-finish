// @ts-nocheck
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ConfirmAction } from '@/components/ui/confirm-action';
import { ImageUpload } from '@/components/ui/image-upload';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { Shield, Search, CheckCircle, XCircle, User, Phone, Car, Clock, Loader2 } from 'lucide-react';

interface VerifiedVisitor {
  id: string;
  visitor_name: string;
  visitor_phone: string | null;
  visitor_type: string;
  vehicle_number: string | null;
  flat_number: string | null;
  expected_time: string | null;
  status: string;
  resident_name?: string;
}

interface Props {
  societyId: string;
}

export function GuardVisitorOTPTab({ societyId }: Props) {
  const [otpInput, setOtpInput] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [isAllowing, setIsAllowing] = useState(false);
  const [verifiedVisitor, setVerifiedVisitor] = useState<VerifiedVisitor | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<'idle' | 'success' | 'failed'>('idle');

  const handleVerifyOTP = async () => {
    if (!otpInput.trim() || otpInput.length !== 6 || !societyId) return;
    setIsVerifying(true);
    setVerifiedVisitor(null);
    setVerificationStatus('idle');

    const { data, error } = await supabase
      .from('visitor_entries')
      .select('*, resident:profiles!visitor_entries_resident_id_fkey(name)')
      .eq('society_id', societyId)
      .eq('otp_code', otpInput.trim())
      .eq('status', 'expected')
      .gte('otp_expires_at', new Date().toISOString()) // Fix V3: check OTP expiry
      .maybeSingle();

    if (error || !data) {
      setVerificationStatus('failed');
      toast.error('Invalid or expired OTP');
    } else {
      setVerifiedVisitor({
        id: data.id,
        visitor_name: data.visitor_name,
        visitor_phone: data.visitor_phone,
        visitor_type: data.visitor_type,
        vehicle_number: data.vehicle_number,
        flat_number: data.flat_number,
        expected_time: data.expected_time,
        status: data.status,
        resident_name: (data as any).resident?.name,
      });
      setVerificationStatus('success');
    }
    setIsVerifying(false);
  };

  const handleAllowEntry = async () => {
    if (!verifiedVisitor) return;
    setIsAllowing(true);
    const { error } = await supabase.from('visitor_entries')
      .update({ 
        status: 'checked_in', 
        checked_in_at: new Date().toISOString(),
        photo_url: visitorPhotoUrl || null,
      })
      .eq('id', verifiedVisitor.id);

    if (!error) {
      toast.success(`${verifiedVisitor.visitor_name} checked in`);
      reset();
    }
    setIsAllowing(false);
  };

  const handleDeny = () => {
    reset();
    toast.info('Entry denied');
  };

  const [visitorPhotoUrl, setVisitorPhotoUrl] = useState<string | null>(null);

  const reset = () => {
    setVerifiedVisitor(null);
    setOtpInput('');
    setVerificationStatus('idle');
    setVisitorPhotoUrl(null);
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 border-primary/30">
        <CardContent className="p-6 space-y-4">
          <div className="text-center">
            <Shield className="mx-auto text-primary mb-2" size={40} />
            <h2 className="text-xl font-bold">Verify Visitor OTP</h2>
            <p className="text-sm text-muted-foreground">Enter the 6-digit OTP shared by the resident</p>
          </div>

          <Input
            value={otpInput}
            onChange={e => {
              const val = e.target.value.replace(/\D/g, '').slice(0, 6);
              setOtpInput(val);
              if (val.length < 6) setVerificationStatus('idle');
            }}
            placeholder="Enter 6-digit OTP"
            className="text-center text-3xl font-mono tracking-[0.5em] h-16"
            maxLength={6}
            inputMode="numeric"
          />

          <Button
            onClick={handleVerifyOTP}
            disabled={otpInput.length !== 6 || isVerifying}
            className="w-full h-14 text-lg"
            size="lg"
          >
            {isVerifying ? <Loader2 size={20} className="mr-2 animate-spin" /> : <Search size={20} className="mr-2" />}
            {isVerifying ? 'Verifying...' : 'Verify OTP'}
          </Button>
        </CardContent>
      </Card>

      {verificationStatus === 'failed' && (
        <Card className="border-destructive/50 bg-destructive/5">
          <CardContent className="p-6 text-center">
            <XCircle className="mx-auto text-destructive mb-3" size={48} />
            <p className="text-lg font-bold text-destructive">Invalid OTP</p>
            <p className="text-sm text-muted-foreground mt-1">
              No matching visitor found or OTP has expired. Check and try again.
            </p>
          </CardContent>
        </Card>
      )}

      {verificationStatus === 'success' && verifiedVisitor && (
        <Card className="border-success/50 bg-success/5">
          <CardContent className="p-6 space-y-4">
            <div className="text-center">
              <CheckCircle className="mx-auto text-success mb-2" size={48} />
              <p className="text-lg font-bold text-success">OTP Verified</p>
            </div>

            <div className="space-y-3 bg-background rounded-lg p-4">
              <div className="flex items-center gap-3">
                <User size={18} className="text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Visitor</p>
                  <p className="font-bold text-lg">{verifiedVisitor.visitor_name}</p>
                </div>
              </div>

              {verifiedVisitor.visitor_phone && (
                <div className="flex items-center gap-3">
                  <Phone size={18} className="text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Phone</p>
                    <p className="font-medium">{verifiedVisitor.visitor_phone}</p>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3">
                <Shield size={18} className="text-muted-foreground" />
                <div>
                  <p className="text-xs text-muted-foreground">Visiting</p>
                  <p className="font-medium">
                    {verifiedVisitor.resident_name || 'Unknown'}
                    {verifiedVisitor.flat_number && ` • Flat ${verifiedVisitor.flat_number}`}
                  </p>
                </div>
              </div>

              {verifiedVisitor.vehicle_number && (
                <div className="flex items-center gap-3">
                  <Car size={18} className="text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Vehicle</p>
                    <p className="font-medium font-mono">{verifiedVisitor.vehicle_number}</p>
                  </div>
                </div>
              )}

              {verifiedVisitor.expected_time && (
                <div className="flex items-center gap-3">
                  <Clock size={18} className="text-muted-foreground" />
                  <div>
                    <p className="text-xs text-muted-foreground">Expected</p>
                    <p className="font-medium">{verifiedVisitor.expected_time}</p>
                  </div>
                </div>
              )}

              <Badge variant="outline" className="capitalize">{verifiedVisitor.visitor_type.replace('_', ' ')}</Badge>
            </div>

            {/* Visitor Photo Capture */}
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Capture Visitor Photo (optional)</p>
              <ImageUpload
                value={visitorPhotoUrl}
                onChange={setVisitorPhotoUrl}
                folder="visitors"
                userId="guard"
                placeholder="Take visitor photo"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <ConfirmAction
                title="Deny Entry?"
                description={`Are you sure you want to deny entry to ${verifiedVisitor.visitor_name}?`}
                actionLabel="Deny Entry"
                onConfirm={handleDeny}
              >
                <Button variant="destructive" size="lg" className="h-14 text-lg w-full">
                  <XCircle size={20} className="mr-2" /> Deny
                </Button>
              </ConfirmAction>
              <Button variant="default" size="lg" className="h-14 text-lg" onClick={handleAllowEntry} disabled={isAllowing}>
                {isAllowing ? <Loader2 size={20} className="mr-2 animate-spin" /> : <CheckCircle size={20} className="mr-2" />} Allow
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
