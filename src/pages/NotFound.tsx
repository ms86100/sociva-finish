// @ts-nocheck
import { useLocation, useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Home, ArrowLeft } from "lucide-react";

const NotFound = () => {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  const handleGoBack = () => {
    // On cold start from deep link, there's no history to go back to
    if (window.history.length <= 2) {
      navigate('/', { replace: true });
    } else {
      window.history.back();
    }
  };

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-background p-6">
      <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mb-6">
        <span className="text-4xl font-bold text-muted-foreground">404</span>
      </div>
      <h1 className="text-xl font-bold text-center mb-2">Page not found</h1>
      <p className="text-sm text-muted-foreground text-center mb-6 max-w-sm">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <div className="flex gap-3">
        <Button variant="outline" onClick={handleGoBack}>
          <ArrowLeft size={16} className="mr-2" />
          Go Back
        </Button>
        <Button onClick={() => navigate('/', { replace: true })}>
          <Home size={16} className="mr-2" />
          Home
        </Button>
      </div>
    </div>
  );
};

export default NotFound;
