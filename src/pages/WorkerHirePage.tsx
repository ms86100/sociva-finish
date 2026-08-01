// @ts-nocheck
import { useAuth } from '@/contexts/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Button } from '@/components/ui/button';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { ResidentJobsList } from '@/components/worker/ResidentJobsList';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function WorkerHirePage() {
  const navigate = useNavigate();

  return (
    <AppLayout headerTitle="Hire Help">
      <FeatureGate feature="worker_marketplace">
        <div className="p-4 pb-24">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold">Your Job Requests</h2>
            <Button onClick={() => navigate('/worker-hire/create')}>
              <Plus size={16} className="mr-1" /> Post Job
            </Button>
          </div>
          <ResidentJobsList />
        </div>
      </FeatureGate>
    </AppLayout>
  );
}
