// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AppLayout } from '@/components/layout/AppLayout';
import { Shield } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { QrCode, KeyRound, Truck, Users, ClipboardList, UserX, ScrollText } from 'lucide-react';
import { GuardResidentQRTab } from '@/components/guard/GuardResidentQRTab';
import { GuardVisitorOTPTab } from '@/components/guard/GuardVisitorOTPTab';
import { GuardDeliveryTab } from '@/components/guard/GuardDeliveryTab';
import { WorkerGateValidation } from '@/components/workforce/WorkerGateValidation';
import { ExpectedVisitorsList } from '@/components/guard/ExpectedVisitorsList';
import { GuardManualEntryTab } from '@/components/guard/GuardManualEntryTab';
import { GuardGateLogTab } from '@/components/guard/GuardGateLogTab';
import { FeatureGate } from '@/components/ui/FeatureGate';

export default function GuardKioskPage() {
  const { effectiveSocietyId, isSocietyAdmin, isAdmin } = useAuth();
  const [isSecurityOfficer, setIsSecurityOfficer] = useState(false);

  useEffect(() => {
    const checkSecurityAccess = async () => {
      if (!effectiveSocietyId) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.rpc('is_security_officer', {
        _user_id: user.id,
        _society_id: effectiveSocietyId,
      });
      setIsSecurityOfficer(!!data);
    };
    checkSecurityAccess();
  }, [effectiveSocietyId]);

  if (!isSocietyAdmin && !isAdmin && !isSecurityOfficer) {
    return (
      <AppLayout headerTitle="Guard Console" showLocation={false}>
        <div className="p-4 text-center py-20 text-muted-foreground">
          <Shield size={48} className="mx-auto mb-4 opacity-50" />
          <p className="font-medium">Access Restricted</p>
          <p className="text-sm">Only society admins and security officers can access the guard console.</p>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerTitle="Guard Console" showLocation={false}>
      <FeatureGate feature="guard_kiosk">
        <div className="p-4 space-y-4">
          <Tabs defaultValue="resident">
            <TabsList className="w-full flex overflow-x-auto scrollbar-hide h-auto">
              <TabsTrigger value="resident" className="text-[9px] gap-0.5 flex-col h-auto py-2 min-h-[44px]">
                <QrCode size={14} />
                QR
              </TabsTrigger>
              <TabsTrigger value="visitor" className="text-[9px] gap-0.5 flex-col h-auto py-2 min-h-[44px]">
                <KeyRound size={14} />
                OTP
              </TabsTrigger>
              <TabsTrigger value="manual" className="text-[9px] gap-0.5 flex-col h-auto py-2 min-h-[44px]">
                <UserX size={14} />
                Manual
              </TabsTrigger>
              <TabsTrigger value="delivery" className="text-[9px] gap-0.5 flex-col h-auto py-2 min-h-[44px]">
                <Truck size={14} />
                Delivery
              </TabsTrigger>
              <TabsTrigger value="worker" className="text-[9px] gap-0.5 flex-col h-auto py-2 min-h-[44px]">
                <Users size={14} />
                Worker
              </TabsTrigger>
              <TabsTrigger value="expected" className="text-[9px] gap-0.5 flex-col h-auto py-2 min-h-[44px]">
                <ClipboardList size={14} />
                Expected
              </TabsTrigger>
              <TabsTrigger value="log" className="text-[9px] gap-0.5 flex-col h-auto py-2 min-h-[44px]">
                <ScrollText size={14} />
                Log
              </TabsTrigger>
            </TabsList>

            <TabsContent value="resident" className="mt-4">
              {effectiveSocietyId && <GuardResidentQRTab societyId={effectiveSocietyId} />}
            </TabsContent>

            <TabsContent value="visitor" className="mt-4">
              {effectiveSocietyId && <GuardVisitorOTPTab societyId={effectiveSocietyId} />}
            </TabsContent>

            <TabsContent value="manual" className="mt-4">
              {effectiveSocietyId && <GuardManualEntryTab societyId={effectiveSocietyId} />}
            </TabsContent>

            <TabsContent value="delivery" className="mt-4">
              {effectiveSocietyId && <GuardDeliveryTab societyId={effectiveSocietyId} />}
            </TabsContent>

            <TabsContent value="worker" className="mt-4">
              <WorkerGateValidation />
            </TabsContent>

            <TabsContent value="expected" className="mt-4">
              {effectiveSocietyId && <ExpectedVisitorsList societyId={effectiveSocietyId} />}
            </TabsContent>

            <TabsContent value="log" className="mt-4">
              {effectiveSocietyId && <GuardGateLogTab societyId={effectiveSocietyId} />}
            </TabsContent>
          </Tabs>
        </div>
      </FeatureGate>
    </AppLayout>
  );
}
