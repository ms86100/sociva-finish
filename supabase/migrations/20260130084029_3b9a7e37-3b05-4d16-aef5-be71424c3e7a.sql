-- Create reports table for abuse tracking
CREATE TABLE public.reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  reporter_id UUID NOT NULL,
  reported_user_id UUID,
  reported_seller_id UUID,
  report_type TEXT NOT NULL CHECK (report_type IN ('spam', 'harassment', 'fraud', 'inappropriate', 'other')),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'resolved', 'dismissed')),
  admin_notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create warnings table for warning users before suspension
CREATE TABLE public.warnings (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  issued_by UUID NOT NULL,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('warning', 'final_warning')),
  acknowledged_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.warnings ENABLE ROW LEVEL SECURITY;

-- Reports policies
CREATE POLICY "Users can create reports"
ON public.reports
FOR INSERT
WITH CHECK (reporter_id = auth.uid());

CREATE POLICY "Users can view their own reports"
ON public.reports
FOR SELECT
USING (reporter_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Admins can update reports"
ON public.reports
FOR UPDATE
USING (is_admin(auth.uid()));

-- Warnings policies
CREATE POLICY "Users can view their own warnings"
ON public.warnings
FOR SELECT
USING (user_id = auth.uid() OR is_admin(auth.uid()));

CREATE POLICY "Admins can create warnings"
ON public.warnings
FOR INSERT
WITH CHECK (is_admin(auth.uid()));

CREATE POLICY "Users can acknowledge their warnings"
ON public.warnings
FOR UPDATE
USING (user_id = auth.uid() OR is_admin(auth.uid()));

-- Add trigger for updated_at
CREATE TRIGGER update_reports_updated_at
BEFORE UPDATE ON public.reports
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();