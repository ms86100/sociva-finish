// @ts-nocheck
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { friendlyError } from '@/lib/utils';
import { Key, Loader2, Eye, EyeOff, CheckCircle2, Home } from 'lucide-react';
import { PasswordStrengthIndicator } from '@/components/auth/PasswordStrengthIndicator';
import { passwordSchema } from '@/lib/validation-schemas';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [isRecoverySession, setIsRecoverySession] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    // Listen for PASSWORD_RECOVERY event from the auth state change
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecoverySession(true);
        setIsCheckingSession(false);
      }
    });

    // Also check if we already have a session (user might have already landed)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        // Check URL hash for recovery type
        const hash = window.location.hash;
        if (hash.includes('type=recovery') || hash.includes('type=magiclink')) {
          setIsRecoverySession(true);
        } else {
          // We have a session but it might be a recovery session already processed
          setIsRecoverySession(true);
        }
      }
      setIsCheckingSession(false);
    });

    // Timeout fallback
    const timeout = setTimeout(() => setIsCheckingSession(false), 3000);

    return () => {
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleUpdatePassword = async () => {
    const validation = passwordSchema.safeParse(password);
    if (!validation.success) {
      toast.error(validation.error.issues[0]?.message || 'Invalid password');
      return;
    }

    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }

    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setIsSuccess(true);
      toast.success('Password updated successfully!');
    } catch (error: any) {
      toast.error(friendlyError(error));
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingSession) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <div className="animate-pulse text-primary text-xl font-bold">Verifying reset link...</div>
      </div>
    );
  }

  if (!isRecoverySession && !isSuccess) {
    return (
      <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm text-center space-y-4">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-destructive/10 flex items-center justify-center">
            <Key className="text-destructive" size={26} />
          </div>
          <h2 className="text-xl font-bold">Invalid Reset Link</h2>
          <p className="text-sm text-muted-foreground">
            This password reset link is invalid or has expired. Please request a new one.
          </p>
          <Button onClick={() => navigate('/auth')} className="w-full h-12 rounded-xl">
            Go to Login
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center bg-gradient-to-b from-background to-secondary/20 p-6">
      <div className="w-full max-w-sm">
        <div className="bg-card rounded-2xl border border-border shadow-lg p-6 space-y-6">
          {isSuccess ? (
            <div className="text-center space-y-4">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center">
                <CheckCircle2 className="text-primary" size={32} />
              </div>
              <h2 className="text-xl font-bold">Password Updated!</h2>
              <p className="text-sm text-muted-foreground">
                Your password has been successfully changed. You can now log in with your new password.
              </p>
              <Button onClick={() => navigate('/auth')} className="w-full h-12 rounded-xl text-base font-semibold">
                <Home className="mr-2" size={18} /> Go to Login
              </Button>
            </div>
          ) : (
            <>
              <div className="text-center">
                <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/5 flex items-center justify-center mb-3">
                  <Key className="text-primary" size={26} />
                </div>
                <h2 className="text-xl font-bold">Set New Password</h2>
                <p className="text-sm text-muted-foreground mt-1">Enter your new password below</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">New Password</Label>
                  <div className="relative">
                    <Input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Min 6 characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 rounded-xl pr-12"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <PasswordStrengthIndicator password={password} />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Confirm Password</Label>
                  <Input
                    id="confirm-password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="h-12 rounded-xl"
                  />
                  {confirmPassword && password !== confirmPassword && (
                    <p className="text-xs text-destructive">Passwords do not match</p>
                  )}
                </div>

                <Button
                  onClick={handleUpdatePassword}
                  disabled={!password || password.length < 6 || password !== confirmPassword || isLoading}
                  className="w-full h-12 rounded-xl text-base font-semibold"
                >
                  {isLoading ? <Loader2 className="animate-spin mr-2" size={18} /> : <Key className="mr-2" size={18} />}
                  Update Password
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
