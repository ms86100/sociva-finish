// @ts-nocheck
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, CheckCircle2, XCircle, Clock, Search, Filter, BarChart3, FileText, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SafeHeader } from '@/components/layout/SafeHeader';
import { format } from "date-fns";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";

interface TestResult {
  id: string;
  run_id: string;
  module_name: string;
  test_name: string;
  page_or_api_url: string | null;
  input_data: any;
  outcome: string;
  duration_ms: number | null;
  response_payload: any;
  error_message: string | null;
  error_code: string | null;
  http_status_code: number | null;
  file_path: string | null;
  executed_at: string;
  created_at: string;
}

export default function TestResultsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [runFilter, setRunFilter] = useState<string>("all");
  const [selectedResult, setSelectedResult] = useState<TestResult | null>(null);

  const { data: results = [], isLoading } = useQuery({
    queryKey: ["test-results"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("test_results")
        .select("*")
        .order("executed_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return data as TestResult[];
    },
  });

  const runs = useMemo(() => {
    const unique = [...new Set(results.map((r) => r.run_id))];
    return unique;
  }, [results]);

  const modules = useMemo(() => {
    const unique = [...new Set(results.map((r) => r.module_name).filter(Boolean))];
    return unique.sort();
  }, [results]);

  const filtered = useMemo(() => {
    return results.filter((r) => {
      if (outcomeFilter !== "all" && r.outcome !== outcomeFilter) return false;
      if (moduleFilter !== "all" && r.module_name !== moduleFilter) return false;
      if (runFilter !== "all" && r.run_id !== runFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          r.test_name?.toLowerCase().includes(q) ||
          r.module_name?.toLowerCase().includes(q) ||
          r.error_message?.toLowerCase().includes(q) ||
          r.page_or_api_url?.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [results, outcomeFilter, moduleFilter, runFilter, search]);

  const stats = useMemo(() => {
    const passed = filtered.filter((r) => r.outcome === "passed").length;
    const failed = filtered.filter((r) => r.outcome === "failed").length;
    const total = filtered.length;
    const avgDuration = total > 0
      ? filtered.reduce((sum, r) => sum + (r.duration_ms ?? 0), 0) / total
      : 0;
    return { passed, failed, total, avgDuration, passRate: total > 0 ? ((passed / total) * 100).toFixed(1) : "0" };
  }, [filtered]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] bg-background p-4 space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* Header */}
      <SafeHeader>
      <div className="px-4 pb-3 flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-lg font-bold">Test Results</h1>
          <p className="text-xs text-muted-foreground">{results.length} results across {runs.length} run(s)</p>
        </div>
      </div>
      </SafeHeader>

      <div className="p-4 space-y-4 max-w-7xl mx-auto">
        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <BarChart3 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{stats.total}</p>
                <p className="text-xs text-muted-foreground">Total Tests</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-success/10">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </div>
              <div>
                <p className="text-2xl font-bold text-success tabular-nums">{stats.passed}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{stats.passRate}% Pass Rate</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-destructive/10">
                <XCircle className="h-5 w-5 text-destructive" />
              </div>
              <div>
                <p className="text-2xl font-bold text-destructive tabular-nums">{stats.failed}</p>
                <p className="text-xs text-muted-foreground">Failed</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-warning/10">
                <Clock className="h-5 w-5 text-warning" />
              </div>
              <div>
                <p className="text-2xl font-bold tabular-nums">{stats.avgDuration.toFixed(0)}<span className="text-sm font-normal text-muted-foreground">ms</span></p>
                <p className="text-xs text-muted-foreground">Avg Duration</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters */}
        <Card>
          <CardContent className="p-3 flex flex-wrap gap-2 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search tests, modules, errors..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={outcomeFilter} onValueChange={setOutcomeFilter}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Outcome" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Outcomes</SelectItem>
                <SelectItem value="passed">Passed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
            <Select value={moduleFilter} onValueChange={setModuleFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Module" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Modules</SelectItem>
                {modules.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={runFilter} onValueChange={setRunFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Run" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Runs</SelectItem>
                {runs.map((r) => (
                  <SelectItem key={r} value={r}>{r.slice(0, 8)}…</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Results Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Test Executions ({filtered.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[60px]">Status</TableHead>
                    <TableHead>Test Name</TableHead>
                    <TableHead className="hidden md:table-cell">Module</TableHead>
                    <TableHead className="hidden lg:table-cell">Page/URL</TableHead>
                    <TableHead className="hidden sm:table-cell w-[80px]">Duration</TableHead>
                    <TableHead className="hidden lg:table-cell">Run ID</TableHead>
                    <TableHead className="hidden md:table-cell">Executed</TableHead>
                    <TableHead className="w-[40px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-12 text-muted-foreground">
                        No test results found
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.slice(0, 200).map((r) => (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer"
                        onClick={() => setSelectedResult(r)}
                      >
                        <TableCell>
                          {r.outcome === "passed" ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" />
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium line-clamp-1">{r.test_name}</span>
                            {r.error_message && (
                              <span className="text-xs text-destructive line-clamp-1 flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 shrink-0" />
                                {r.error_message.slice(0, 80)}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="hidden md:table-cell">
                          <Badge variant="secondary" className="text-xs font-normal">{r.module_name}</Badge>
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                          {r.page_or_api_url || "—"}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-xs tabular-nums">
                          {r.duration_ms != null ? `${r.duration_ms.toFixed(0)}ms` : "—"}
                        </TableCell>
                        <TableCell className="hidden lg:table-cell text-xs text-muted-foreground font-mono">
                          {r.run_id?.slice(0, 8)}
                        </TableCell>
                        <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                          {r.executed_at ? format(new Date(r.executed_at), "MMM d, HH:mm") : "—"}
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); setSelectedResult(r); }}>
                            <Filter className="h-3.5 w-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
            {filtered.length > 200 && (
              <p className="text-xs text-muted-foreground text-center py-3">
                Showing 200 of {filtered.length} results. Use filters to narrow down.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Detail Sheet */}
      <Sheet open={!!selectedResult} onOpenChange={(open) => !open && setSelectedResult(null)}>
        <SheetContent className="w-full sm:max-w-lg">
          {selectedResult && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-base">
                  {selectedResult.outcome === "passed" ? (
                    <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
                  ) : (
                    <XCircle className="h-5 w-5 text-destructive shrink-0" />
                  )}
                  <span className="line-clamp-2">{selectedResult.test_name}</span>
                </SheetTitle>
              </SheetHeader>
              <ScrollArea className="h-[calc(100vh-100px)] mt-4">
                <div className="space-y-4 pr-4">
                  <DetailRow label="Module" value={selectedResult.module_name} />
                  <DetailRow label="Outcome" value={
                    <Badge variant={selectedResult.outcome === "passed" ? "default" : "destructive"}>
                      {selectedResult.outcome}
                    </Badge>
                  } />
                  <DetailRow label="Page / URL" value={selectedResult.page_or_api_url || "—"} />
                  <DetailRow label="Duration" value={selectedResult.duration_ms != null ? `${selectedResult.duration_ms.toFixed(1)} ms` : "—"} />
                  <DetailRow label="Run ID" value={<span className="font-mono text-xs">{selectedResult.run_id}</span>} />
                  <DetailRow label="File" value={<span className="font-mono text-xs break-all">{selectedResult.file_path || "—"}</span>} />
                  <DetailRow label="Executed At" value={selectedResult.executed_at ? format(new Date(selectedResult.executed_at), "PPpp") : "—"} />
                  {selectedResult.http_status_code && (
                    <DetailRow label="HTTP Status" value={String(selectedResult.http_status_code)} />
                  )}
                  {selectedResult.error_code && (
                    <DetailRow label="Error Code" value={selectedResult.error_code} />
                  )}
                  {selectedResult.error_message && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Error Message</p>
                      <pre className="text-xs bg-destructive/5 border border-destructive/20 rounded-lg p-3 whitespace-pre-wrap break-words text-destructive">
                        {selectedResult.error_message}
                      </pre>
                    </div>
                  )}
                  {selectedResult.input_data && Object.keys(selectedResult.input_data).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Input Data</p>
                      <pre className="text-xs bg-muted rounded-lg p-3 whitespace-pre-wrap break-words">
                        {JSON.stringify(selectedResult.input_data, null, 2)}
                      </pre>
                    </div>
                  )}
                  {selectedResult.response_payload && Object.keys(selectedResult.response_payload).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground mb-1">Response Payload</p>
                      <pre className="text-xs bg-muted rounded-lg p-3 whitespace-pre-wrap break-words">
                        {JSON.stringify(selectedResult.response_payload, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <p className="text-xs font-medium text-muted-foreground shrink-0">{label}</p>
      <div className="text-sm text-right">{value}</div>
    </div>
  );
}
