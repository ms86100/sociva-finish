// @ts-nocheck
import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ImageUpload } from '@/components/ui/image-upload';
import { DeleteAccountDialog } from '@/components/profile/DeleteAccountDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useEffectiveFeatures } from '@/hooks/useEffectiveFeatures';
import { useQuery } from '@tanstack/react-query';
import {
  User,
  MapPin,
  Phone,
  Mail,
  Store,
  Package,
  Heart,
  LogOut,
  ChevronRight,
  Shield,
  HelpCircle,
  Bell,
  Type,
  FileText,
  Camera,
  Repeat,
  Building2,
} from 'lucide-react';
import { FeedbackSheet } from '@/components/feedback/FeedbackSheet';
import { NotificationHealthCheck } from '@/components/notifications/NotificationHealthCheck';
import { toast } from 'sonner';
import { showFeedback, useFeedbackPopup } from '@/components/FeedbackPopupProvider';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { getFlag, setFlag, getString, removeKey } from '@/lib/persistent-kv';
import { useTheme } from 'next-themes';
import { Moon, Sun, RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

export default function ProfilePage() {
  const navigate = useNavigate();
  const {
    user, profile, society, isSeller, isAdmin, isBuilderMember, signOut, refreshProfile,
    isProfileLoading, profileError,
  } = useAuth();
  const { isFeatureEnabled } = useEffectiveFeatures();
  const settings = useSystemSettings();
  const { theme, setTheme } = useTheme();
  const { showFeedback } = useFeedbackPopup();
  const [largeFont, setLargeFont] = useState(() => getFlag('app_large_font'));
  const [isEditingAvatar, setIsEditingAvatar] = useState(false);
  const [showOnboardingFeedback, setShowOnboardingFeedback] = useState(false);
  const [isSigningOut, setIsSigningOutLocal] = useState(false);

  const showProfileSkeleton = !!user && !profile && !profileError;

  useEffect(() => {
    if (getString('seller_onboarding_completed') === 'true') {
      setShowOnboardingFeedback(true);
      removeKey('seller_onboarding_completed');
    }
  }, []);

  const { data: skillBadges = [] } = useQuery({
    queryKey: ['skill-badges', user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from('skill_listings')
        .select('skill_name, trust_score, endorsement_count')
        .eq('user_id', user!.id)
        .order('trust_score', { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!user,
    staleTime: 15 * 60 * 1000,
  });

  useEffect(() => {
    if (largeFont) document.documentElement.classList.add('large-font');
    else document.documentElement.classList.remove('large-font');
    setFlag('app_large_font', largeFont);
  }, [largeFont]);

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOutLocal(true);
    try {
      await signOut();
      navigate('/auth', { replace: true });
    } finally {
      setIsSigningOutLocal(false);
    }
  };

  const handleAvatarChange = async (url: string | null) => {
    if (!user) return;
    try {
      const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', user.id);
      if (error) throw error;
      await refreshProfile();
      showFeedback({
        title: 'Profile photo updated',
        variant: 'success'
      });
      setIsEditingAvatar(false);
    } catch (error: any) {
      console.error('Error updating avatar:', error);
      toast.error('Failed to update profile photo');
    }
  };

  const quickActions = [
    { icon: Package, label: 'Orders', to: '/orders', key: 'orders' },
    { icon: Heart, label: 'Favorites', to: '/favorites', key: 'favorites' },
    { icon: Repeat, label: 'Reorder', to: '/search', key: 'reorder' },
    ...(isSeller ? [{ icon: Store, label: 'My Store', to: '/seller', key: 'seller' }] : []),
  ];

  const menuItems = [
    ...(isBuilderMember
      ? [{ icon: Building2, label: 'Builder Dashboard', to: '/builder' }]
      : []),
    ...(isSeller
      ? [{ icon: Store, label: 'Seller Dashboard', to: '/seller' }]
      : []),
    { icon: Bell, label: 'Notifications', to: '/notifications' },
    { icon: HelpCircle, label: 'Help & Guide', to: '/help' },
    ...(isAdmin ? [{ icon: Shield, label: 'Admin Panel', to: '/admin' }] : []),
    { icon: FileText, label: 'Privacy Policy', to: '/privacy-policy' },
    { icon: FileText, label: 'Terms & Conditions', to: '/terms' },
    { icon: FileText, label: 'Community Rules', to: '/community-rules' },
  ];

  return (
    <AppLayout headerTitle="Profile">
      <div className="pb-8">
        {profileError && (
          <div className="mx-4 mt-4 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-3 flex items-start gap-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">Couldn’t load your account</p>
              <p className="text-xs text-muted-foreground mt-0.5">{profileError}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 gap-1.5"
              disabled={isProfileLoading}
              onClick={() => refreshProfile()}
            >
              <RefreshCw size={14} className={isProfileLoading ? 'animate-spin' : ''} />
              Retry
            </Button>
          </div>
        )}

        {/* Profile Header */}
        <div className="bg-card border-b border-border px-4 pt-6 pb-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              {(showProfileSkeleton || (isProfileLoading && !profile)) ? (
                <Skeleton className="w-16 h-16 rounded-full" />
              ) : isEditingAvatar && user ? (
                <div className="w-20">
                  <ImageUpload value={profile?.avatar_url} onChange={handleAvatarChange} folder="profiles" userId={user.id} aspectRatio="square" placeholder="Upload" />
                  <Button variant="ghost" size="sm" className="w-full mt-1 text-xs" onClick={() => setIsEditingAvatar(false)}>Cancel</Button>
                </div>
              ) : (
                <button
                  onClick={() => setIsEditingAvatar(true)}
                  disabled={!profile}
                  className="w-16 h-16 rounded-full bg-muted flex items-center justify-center relative overflow-hidden group"
                >
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt={profile.name} className="w-full h-full object-cover" />
                  ) : (
                    <User className="text-muted-foreground" size={28} />
                  )}
                   <div className="absolute inset-0 bg-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <Camera className="text-primary-foreground" size={18} />
                  </div>
                </button>
              )}
            </div>
            <div className="flex-1 min-w-0">
              {(showProfileSkeleton || (isProfileLoading && !profile)) ? (
                <div className="space-y-2">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-3 w-48" />
                  <Skeleton className="h-3 w-28" />
                </div>
              ) : (
                <>
                  <h2 className="text-lg font-bold truncate">{profile?.name || '—'}</h2>
                  {society?.name && (
                    <p className="text-xs text-primary font-medium mt-0.5">{society.name}</p>
                  )}
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                    <MapPin size={12} className="shrink-0" />
                    <span className="line-clamp-1">
                      {[profile?.flat_number, profile?.block && `Block ${profile.block}`, profile?.phase].filter(Boolean).join(', ') || '—'}
                    </span>
                  </div>
                  {profile?.phone && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone size={12} />
                      <span>{profile.phone}</span>
                    </div>
                  )}
                  {profile?.email && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Mail size={12} />
                      <span className="truncate">{profile.email}</span>
                    </div>
                  )}
                </>
              )}
            </div>
            <Link to="/profile/edit" className="shrink-0">
              <Button variant="ghost" size="sm" className="h-8 text-xs text-primary" disabled={!profile}>Edit</Button>
            </Link>
          </div>

          {profile?.verification_status === 'approved' && (
            <div className="mt-3 flex items-center gap-1.5 text-[11px] text-accent font-medium">
              <Shield size={12} />
              <span>Verified Resident</span>
            </div>
          )}

          {skillBadges.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {skillBadges.map((badge) => (
                <span key={badge.skill_name} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[10px] font-medium">
                  <Award size={9} />
                  {badge.skill_name}
                  {badge.trust_score > 0 && <span className="text-muted-foreground">· {badge.trust_score}</span>}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className={`grid ${quickActions.length > 3 ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'} gap-2.5 px-4 mt-4`}>
          {quickActions.map(({ icon: Icon, label, to, key }) => (
            <Link key={key} to={to}>
              <div className="bg-card border border-border rounded-xl p-3 flex flex-col items-center gap-1.5 active:scale-[0.97] transition-transform">
                <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                  <Icon size={18} className="text-foreground" />
                </div>
                <span className="text-xs font-medium">{label}</span>
              </div>
            </Link>
          ))}
        </div>

        {/* Quick Access Cards */}
        <div className="px-4 mt-4 space-y-2">
          {isFeatureEnabled('resident_identity_verification') && (
            <Link to="/gate-entry">
              <div className="bg-card border border-border/40 rounded-2xl p-3.5 flex items-center gap-3 transition-all active:scale-[0.98]">
                <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
                  <Shield className="text-primary-foreground" size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm text-foreground">Gate Entry</h4>
                  <p className="text-[11px] text-muted-foreground">Show QR code to security</p>
                </div>
                <ChevronRight className="text-muted-foreground shrink-0" size={18} />
              </div>
            </Link>
          )}
          {!isSeller && (
            <Link to="/become-seller">
              <div className="bg-accent rounded-2xl p-3.5 flex items-center gap-3 transition-all active:scale-[0.98]">
                <div className="w-10 h-10 rounded-xl bg-accent-foreground/20 flex items-center justify-center">
                  <Store className="text-accent-foreground" size={20} />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-sm text-accent-foreground">Start Selling</h4>
                  <p className="text-[11px] text-accent-foreground/80">Start selling to your community</p>
                </div>
                <ChevronRight className="text-accent-foreground/60 shrink-0" size={18} />
              </div>
            </Link>
          )}
        </div>

        {/* Accessibility */}
        <div className="mx-4 mt-4 bg-card border border-border rounded-xl divide-y divide-border">
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Type size={16} className="text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Larger Text</p>
                <p className="text-[11px] text-muted-foreground">Easier to read</p>
              </div>
            </div>
            <Switch checked={largeFont} onCheckedChange={setLargeFont} />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {theme === 'dark' ? <Moon size={16} className="text-muted-foreground" /> : <Sun size={16} className="text-muted-foreground" />}
              <div>
                <p className="text-sm font-medium">Dark Mode</p>
                <p className="text-[11px] text-muted-foreground">Switch appearance</p>
              </div>
            </div>
            <Switch checked={theme === 'dark'} onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')} />
          </div>
        </div>

        {/* Menu List */}
        <div className="mt-4 px-4 space-y-px">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">Your Information</p>
          {menuItems.slice(0, menuItems.findIndex(m => m.label === 'Privacy Policy')).map(({ icon: Icon, label, to }) => (
            <Link key={label} to={to}>
              <div className="flex items-center gap-3 px-3 py-3.5 rounded-lg hover:bg-muted/50 active:bg-muted transition-colors">
                <Icon size={18} className="text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm font-medium">{label}</span>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
            </Link>
          ))}
          <NotificationHealthCheck />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 mt-4 px-1">Legal & Support</p>
          {menuItems.slice(menuItems.findIndex(m => m.label === 'Privacy Policy')).map(({ icon: Icon, label, to }) => (
            <Link key={label} to={to}>
              <div className="flex items-center gap-3 px-3 py-3.5 rounded-lg hover:bg-muted/50 active:bg-muted transition-colors">
                <Icon size={18} className="text-muted-foreground shrink-0" />
                <span className="flex-1 text-sm font-medium">{label}</span>
                <ChevronRight size={16} className="text-muted-foreground" />
              </div>
            </Link>
          ))}
          <FeedbackSheet triggerOpen={showOnboardingFeedback} onOpenChange={() => setShowOnboardingFeedback(false)} />
        </div>

        {/* Sign Out */}
        <div className="px-4 mt-6">
          <Button variant="outline" className="w-full" size="sm" onClick={handleSignOut} disabled={isSigningOut}>
            <LogOut size={16} className="mr-2" />
            {isSigningOut ? 'Signing out…' : 'Sign Out'}
          </Button>
        </div>

        {/* Delete Account */}
        <div className="px-4 mt-8">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-2 px-1">Danger Zone</p>
          <DeleteAccountDialog />
        </div>

        <p className="text-center text-[11px] text-muted-foreground mt-4 pb-2">{settings.platformName} v{settings.appVersion}</p>
      </div>
    </AppLayout>
  );
}
