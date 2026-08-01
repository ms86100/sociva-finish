// @ts-nocheck
import { useState, useMemo } from 'react';
import { AppLayout } from '@/components/layout/AppLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/contexts/AuthContext';
import { useSecurityOfficer } from '@/hooks/useSecurityOfficer';
import { FeatureGate } from '@/components/ui/FeatureGate';
import { useGateAudit, useGateAuditMetrics, GateAuditFilters } from '@/hooks/useGateAudit';
import {
  Shield, Download, ChevronLeft, ChevronRight, Clock, Users,
  AlertTriangle, CheckCircle, XCircle, Search, Filter
} from 'lucide-react';

export default function SecurityAuditPage() {
  const { profile, effectiveSocietyId, isSocietyAdmin, isAdmin } = useAuth();
  const { isSecurityOfficer, isLoading: roleLoading } = useSecurityOfficer();

  // Security officers see only their own verifications; admins see all
  const isOfficerOnly = isSecurityOfficer && !isSocietyAdmin && !isAdmin;

  const [filters, setFilters] = useState<GateAuditFilters>({
    page: 0,
    pageSize: 20,
  });
  const [showFilters, setShowFilters] = useState(false);

  // Scope query: officers only see entries they verified
  const scopedFilters = useMemo<GateAuditFilters>(() => {
    if (isOfficerOnly && profile?.id) {
      return { ...filters, officerId: profile.id };
    }
    return filters;
  }, [filters, isOfficerOnly, profile?.id]);

  const { data: auditData, isLoading } = useGateAudit(effectiveSocietyId, scopedFilters);
  const { data: metrics } = useGateAuditMetrics(effectiveSocietyId);

  const hasAccess = isSocietyAdmin || isAdmin || isSecurityOfficer;

  if (roleLoading) {
    return (
      <AppLayout headerTitle="Security Audit" showLocation={false}>
        <div className="p-4 space-y-4">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </AppLayout>
    );
  }

  if (!hasAccess) {
    return (
      <AppLayout headerTitle="Security Audit" showLocation={false}>
        <div className="p-4 text-center py-20 text-muted-foreground">
          <Shield size={48} className="mx-auto mb-4 opacity-50" />
          <p className="font-medium">Access Restricted</p>
          <p className="text-sm">Only security staff and society admins can access this page.</p>
        </div>
      </AppLayout>
    );
  }

  const entries = auditData?.entries || [];
  const totalEntries = auditData?.total || 0;
  const totalPages = Math.ceil(totalEntries / filters.pageSize);

  const exportCSV = () => {
    if (entries.length === 0) return;
    const headers = ['Time', 'Resident', 'Flat', 'Type', 'Status', 'Verified By'];
    const rows = entries.map((e: any) => [
      new Date(e.entry_time).toLocaleString(),
      e.resident_name || '',
      e.flat_number || '',
      e.entry_type,
      e.confirmation_status,
      e.verified_by || '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gate-entries-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'confirmed':
      case 'not_required':
        return <CheckCircle size={14} className="text-success" />;
      case 'denied':
        return <XCircle size={14} className="text-destructive" />;
      case 'pending':
        return <Clock size={14} className="text-warning" />;
      case 'expired':
        return <Clock size={14} className="text-muted-foreground" />;
      default:
        return <Clock size={14} className="text-muted-foreground" />;
    }
  };

  return (
    <AppLayout headerTitle="Security Audit" showLocation={false}>
      <FeatureGate feature="security_audit">
      <div className="p-4 space-y-4">
        {/* Metrics Cards */}
        {metrics && (
          <div className="grid grid-cols-2 gap-3">
            <Card>
              <CardContent className="p-3 text-center">
                <Users size={18} className="mx-auto text-primary mb-1" />
                <p className="text-2xl font-bold tabular-nums">{metrics.totalToday}</p>
                <p className="text-[10px] text-muted-foreground">Entries Today</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <AlertTriangle size={18} className="mx-auto text-warning mb-1" />
                <p className="text-2xl font-bold tabular-nums">{metrics.manualPercent}%</p>
                <p className="text-[10px] text-muted-foreground">Manual Entries</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <XCircle size={18} className="mx-auto text-destructive mb-1" />
                <p className="text-2xl font-bold tabular-nums">{metrics.deniedPercent}%</p>
                <p className="text-[10px] text-muted-foreground">Denied</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-3 text-center">
                <Clock size={18} className="mx-auto text-info mb-1" />
                <p className="text-2xl font-bold tabular-nums">
                  {metrics.avgConfirmationMs
                    ? `${(metrics.avgConfirmationMs / 1000).toFixed(1)}s`
                    : '—'}
                </p>
                <p className="text-[10px] text-muted-foreground">Avg Confirm Time</p>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filter Toggle + Export */}
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
            className="gap-1"
          >
            <Filter size={14} /> Filters
          </Button>
          <Button variant="outline" size="sm" onClick={exportCSV} className="gap-1">
            <Download size={14} /> Export CSV
          </Button>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">From</label>
                  <Input
                    type="date"
                    value={filters.dateFrom || ''}
                    onChange={(e) =>
                      setFilters(f => ({ ...f, dateFrom: e.target.value || undefined, page: 0 }))
                    }
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">To</label>
                  <Input
                    type="date"
                    value={filters.dateTo || ''}
                    onChange={(e) =>
                      setFilters(f => ({ ...f, dateTo: e.target.value || undefined, page: 0 }))
                    }
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Entry Type</label>
                  <Select
                    value={filters.entryType || 'all'}
                    onValueChange={(v) =>
                      setFilters(f => ({ ...f, entryType: v === 'all' ? undefined : v, page: 0 }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Types</SelectItem>
                      <SelectItem value="qr_verified">QR Verified</SelectItem>
                      <SelectItem value="manual">Manual</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Status</label>
                  <Select
                    value={filters.confirmationStatus || 'all'}
                    onValueChange={(v) =>
                      setFilters(f => ({ ...f, confirmationStatus: v === 'all' ? undefined : v, page: 0 }))
                    }
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="denied">Denied</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="not_required">Not Required</SelectItem>
                      <SelectItem value="expired">Expired</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Resident Name</label>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search by name..."
                    value={filters.residentName || ''}
                    onChange={(e) =>
                      setFilters(f => ({ ...f, residentName: e.target.value || undefined, page: 0 }))
                    }
                    className="pl-9"
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Entries List */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-xl" />)}
          </div>
        ) : entries.length === 0 ? (
          <p className="text-center text-muted-foreground py-12 text-sm">No gate entries found</p>
        ) : (
          <div className="space-y-2">
            {entries.map((entry: any) => (
              <Card key={entry.id}>
                <CardContent className="p-3 flex items-center gap-3">
                  {statusIcon(entry.confirmation_status)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm truncate">
                        {entry.resident_name || 'Unknown'}
                      </p>
                      <Badge variant="outline" className="text-[10px] shrink-0 capitalize">
                        {entry.entry_type.replace('_', ' ')}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {entry.flat_number && `Flat ${entry.flat_number} • `}
                      {new Date(entry.entry_time).toLocaleString()}
                    </p>
                  </div>
                  <Badge
                    variant={
                      entry.confirmation_status === 'denied' ? 'destructive'
                        : entry.confirmation_status === 'confirmed' || entry.confirmation_status === 'not_required'
                          ? 'secondary'
                          : 'outline'
                    }
                    className="text-[10px] shrink-0"
                  >
                    {entry.confirmation_status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page === 0}
              onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
            >
              <ChevronLeft size={14} /> Prev
            </Button>
            <span className="text-xs text-muted-foreground">
              Page {filters.page + 1} of {totalPages} ({totalEntries} total)
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={filters.page >= totalPages - 1}
              onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
            >
              Next <ChevronRight size={14} />
            </Button>
          </div>
        )}
      </div>
      </FeatureGate>
    </AppLayout>
  );
}
