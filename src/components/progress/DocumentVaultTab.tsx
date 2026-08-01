// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FileText, Download, ShieldCheck, Plus } from 'lucide-react';
import { format } from 'date-fns';
import { AddDocumentSheet } from './AddDocumentSheet';

interface ProjectDocument {
  id: string;
  category: string;
  title: string;
  description: string | null;
  file_url: string;
  is_verified: boolean;
  created_at: string;
}

const CATEGORIES = [
  { key: 'rera_registration', label: 'RERA Registration' },
  { key: 'commencement_certificate', label: 'Commencement Certificate' },
  { key: 'environmental_clearance', label: 'Environmental Clearance' },
  { key: 'fire_noc', label: 'Fire NOC' },
  { key: 'oc_status', label: 'OC Status' },
  { key: 'layout_approval', label: 'Layout Approval' },
  { key: 'other', label: 'Other' },
];

export function DocumentVaultTab() {
  const { isAdmin, effectiveSocietyId } = useAuth();
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchDocuments = async () => {
    if (!effectiveSocietyId) return;
    const { data } = await supabase
      .from('project_documents')
      .select('*')
      .eq('society_id', effectiveSocietyId)
      .order('created_at', { ascending: false });
    setDocuments((data as any) || []);
    setIsLoading(false);
  };

  useEffect(() => {
    fetchDocuments();
  }, [effectiveSocietyId]);

  const grouped = CATEGORIES.map((cat) => ({
    ...cat,
    docs: documents.filter((d) => d.category === cat.key),
  })).filter((g) => g.docs.length > 0);

  if (isLoading) return <p className="text-center text-sm text-muted-foreground py-8">Loading...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{documents.length} document{documents.length !== 1 ? 's' : ''}</p>
        {isAdmin && <AddDocumentSheet onAdded={fetchDocuments} />}
      </div>

      {grouped.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <FileText className="mx-auto mb-3" size={32} />
          <p className="text-sm">No documents uploaded yet</p>
          {isAdmin && <p className="text-xs mt-1">Upload RERA, approvals, and other project documents</p>}
        </div>
      ) : (
        <Accordion type="multiple" defaultValue={grouped.map((g) => g.key)}>
          {grouped.map((group) => (
            <AccordionItem key={group.key} value={group.key}>
              <AccordionTrigger className="text-sm font-medium py-2">
                {group.label} ({group.docs.length})
              </AccordionTrigger>
              <AccordionContent className="space-y-2 pb-3">
                {group.docs.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-3 p-2 rounded-lg bg-muted/50">
                    <FileText size={16} className="text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-xs font-medium truncate">{doc.title}</p>
                        {doc.is_verified && (
                          <ShieldCheck size={12} className="text-success shrink-0" />
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {format(new Date(doc.created_at), 'dd MMM yyyy')}
                      </p>
                    </div>
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                        <Download size={14} />
                      </Button>
                    </a>
                  </div>
                ))}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  );
}
