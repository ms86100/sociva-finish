// @ts-nocheck
import { useAuth } from '@/contexts/AuthContext';
import { Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';

export default function ApiDocsPage() {
  const { isAdmin, isLoading } = useAuth();
  const [SwaggerUI, setSwaggerUI] = useState<any>(null);

  useEffect(() => {
    // Dynamic import to avoid SSR issues and reduce bundle size
    Promise.all([
      import('swagger-ui-react'),
      import('swagger-ui-react/swagger-ui.css'),
    ]).then(([mod]) => {
      setSwaggerUI(() => mod.default);
    });
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Skeleton className="h-6 w-32 rounded-lg" />
      </div>
    );
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[1400px] mx-auto">
        {SwaggerUI ? (
          <SwaggerUI
            url="/openapi.json"
            docExpansion="list"
            defaultModelsExpandDepth={-1}
            filter={true}
            tryItOutEnabled={true}
            requestInterceptor={(req: any) => {
              // Auto-inject apikey header for all requests
              req.headers['apikey'] = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
              return req;
            }}
          />
        ) : (
          <div className="flex items-center justify-center py-20">
            <Skeleton className="h-8 w-48 rounded-lg" />
          </div>
        )}
      </div>
    </div>
  );
}
