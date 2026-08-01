// @ts-nocheck
import { useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft } from 'lucide-react';

export function NavigatorBackButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);

  if (params.get('from') !== 'navigator') return null;

  return (
    <Button
      size="sm"
      variant="secondary"
      className="fixed bottom-20 right-4 z-50 shadow-lg gap-1.5 rounded-full px-4"
      onClick={() => navigate('/admin?tab=navigator')}
    >
      <ArrowLeft size={14} />
      Navigator
    </Button>
  );
}
