// @ts-nocheck
import { Lock } from 'lucide-react';

export default function OtpSettings() {
  return (
    <div className="p-6 text-center text-muted-foreground">
      <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-muted flex items-center justify-center">
        <Lock size={20} className="text-muted-foreground" />
      </div>
      <p className="font-semibold text-foreground">OTP Verification Settings</p>
      <p className="text-sm mt-1.5 max-w-xs mx-auto">This feature is being built. You'll be notified when it's ready.</p>
    </div>
  );
}
