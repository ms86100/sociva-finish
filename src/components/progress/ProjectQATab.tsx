// @ts-nocheck
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { MessageCircle, Pin, ShieldCheck, Send, ChevronDown, ChevronUp } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { AskQuestionSheet } from './AskQuestionSheet';
import { cn } from '@/lib/utils';

interface Question {
  id: string;
  asked_by: string;
  category: string;
  question_text: string;
  is_answered: boolean;
  is_pinned: boolean;
  created_at: string;
  asker?: { name: string };
  answers: Answer[];
}

interface Answer {
  id: string;
  answered_by: string;
  answer_text: string;
  is_official: boolean;
  created_at: string;
  responder?: { name: string };
}

const CATEGORY_LABELS: Record<string, string> = {
  construction: 'Construction',
  timeline: 'Timeline',
  payment: 'Payment',
  legal: 'Legal',
  amenities: 'Amenities',
  general: 'General',
};

export function ProjectQATab() {
  const { user, isAdmin, effectiveSocietyId } = useAuth();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedQ, setExpandedQ] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isReplying, setIsReplying] = useState(false);

  const fetchQuestions = async () => {
    if (!effectiveSocietyId) return;

    const { data: qData } = await supabase
      .from('project_questions')
      .select('*, asker:profiles!project_questions_asked_by_fkey(name)')
      .eq('society_id', effectiveSocietyId)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false });

    const qs = (qData as any) || [];
    const qIds = qs.map((q: any) => q.id);

    let answers: any[] = [];
    if (qIds.length > 0) {
      const { data: aData } = await supabase
        .from('project_answers')
        .select('*, responder:profiles!project_answers_answered_by_fkey(name)')
        .in('question_id', qIds)
        .order('created_at', { ascending: true });
      answers = (aData as any) || [];
    }

    setQuestions(qs.map((q: any) => ({
      ...q,
      answers: answers.filter((a: any) => a.question_id === q.id),
    })));
    setIsLoading(false);
  };

  useEffect(() => { fetchQuestions(); }, [effectiveSocietyId]);

  const handleReply = async (questionId: string) => {
    if (!user || !replyText.trim()) return;
    setIsReplying(true);
    try {
      const { error } = await supabase.from('project_answers').insert({
        question_id: questionId,
        answered_by: user.id,
        answer_text: replyText.trim(),
        is_official: isAdmin,
      });
      if (error) throw error;

      if (isAdmin) {
        await supabase.from('project_questions').update({ is_answered: true }).eq('id', questionId);
      }

      toast.success('Answer posted');
      setReplyText('');
      fetchQuestions();
    } catch (e: any) {
      toast.error(e.message || 'Failed to post');
    } finally {
      setIsReplying(false);
    }
  };

  const togglePin = async (q: Question) => {
    await supabase.from('project_questions').update({ is_pinned: !q.is_pinned }).eq('id', q.id);
    fetchQuestions();
  };

  if (isLoading) return <p className="text-center text-sm text-muted-foreground py-8">Loading...</p>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{questions.length} question{questions.length !== 1 ? 's' : ''}</p>
        <AskQuestionSheet onAsked={fetchQuestions} existingQuestions={questions.map(q => q.question_text)} />
      </div>

      {questions.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <MessageCircle className="mx-auto mb-3" size={32} />
          <p className="text-sm">No questions yet</p>
          <p className="text-xs mt-1">Ask about construction, timelines, or amenities</p>
        </div>
      ) : (
        questions.map((q) => (
          <Card key={q.id} className={cn(q.is_pinned && 'border-primary/30')}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 mb-1">
                    {q.is_pinned && <Pin size={10} className="text-primary" />}
                    <Badge variant="outline" className="text-[9px] h-4">
                      {CATEGORY_LABELS[q.category] || q.category}
                    </Badge>
                    {q.is_answered && (
                      <Badge variant="outline" className="text-[9px] h-4 border-success/30 text-success">
                        Answered
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm font-medium">{q.question_text}</p>
                  <p className="text-[10px] text-muted-foreground mt-1">
                    {q.asker?.name} · {format(new Date(q.created_at), 'dd MMM yyyy')}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {isAdmin && (
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => togglePin(q)}>
                      <Pin size={12} className={q.is_pinned ? 'text-primary' : 'text-muted-foreground'} />
                    </Button>
                  )}
                  <Button
                    variant="ghost" size="sm" className="h-6 w-6 p-0"
                    onClick={() => setExpandedQ(expandedQ === q.id ? null : q.id)}
                  >
                    {expandedQ === q.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </Button>
                </div>
              </div>

              {/* Official answer preview */}
              {q.answers.filter(a => a.is_official).length > 0 && expandedQ !== q.id && (
                <div className="bg-success/5 border border-success/20 rounded-md p-2">
                  <div className="flex items-center gap-1 mb-0.5">
                    <ShieldCheck size={10} className="text-success" />
                    <span className="text-[9px] font-medium text-success">Builder Response</span>
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {q.answers.find(a => a.is_official)?.answer_text}
                  </p>
                </div>
              )}

              {/* Expanded answers */}
              {expandedQ === q.id && (
                <div className="space-y-2 pt-1 border-t border-border">
                  {q.answers.map((a) => (
                    <div key={a.id} className={cn('p-2 rounded-md', a.is_official ? 'bg-success/5 border border-success/20' : 'bg-muted/50')}>
                      <div className="flex items-center gap-1 mb-0.5">
                        {a.is_official && <ShieldCheck size={10} className="text-success" />}
                        <span className="text-[10px] font-medium">{a.responder?.name}</span>
                        <span className="text-[9px] text-muted-foreground">· {format(new Date(a.created_at), 'dd MMM')}</span>
                      </div>
                      <p className="text-xs">{a.answer_text}</p>
                    </div>
                  ))}
                  {/* Reply input */}
                  <div className="flex gap-2">
                    <Input
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Write an answer..."
                      className="text-xs h-8"
                    />
                    <Button
                      size="sm" className="h-8 px-3"
                      disabled={!replyText.trim() || isReplying}
                      onClick={() => handleReply(q.id)}
                    >
                      <Send size={12} />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
