// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Users, Copy } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useCreateCircle,
  useJoinCircle,
  useMyCircles,
} from '@/hooks/queries/useCleanerCity';

export default function CleanerCityCirclesPage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: circles = [], isLoading } = useMyCircles();
  const createCircle = useCreateCircle();
  const joinCircle = useJoinCircle();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [inviteCode, setInviteCode] = useState('');

  const ready = !!profile && verification?.status === 'verified' && !profile.is_paused;

  const create = async () => {
    if (!name.trim()) {
      toast.error('Circle name is required');
      return;
    }
    try {
      await createCircle.mutateAsync({ name: name.trim(), description: description.trim() || null });
      toast.success('Circle created');
      setName('');
      setDescription('');
    } catch (e: any) {
      toast.error(e?.message || 'Could not create circle');
    }
  };

  const join = async () => {
    if (!inviteCode.trim()) {
      toast.error('Enter an invite code');
      return;
    }
    try {
      await joinCircle.mutateAsync(inviteCode.trim());
      toast.success('Joined circle');
      setInviteCode('');
    } catch (e: any) {
      toast.error(e?.message || 'Invalid invite code');
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard?.writeText(code);
      toast.success('Invite code copied');
    } catch {
      toast.error('Could not copy - select and copy manually');
    }
  };

  return (
    <AppLayout headerTitle="Trusted circles">
      <CleanerCityGate>
        <div className="p-4 pb-24 space-y-4" data-testid="cleaner-city-circles-page">
          {!ready && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950 text-sm">
              Complete{' '}
              <Link to="/cleaner-city/setup" className="font-semibold underline">
                set up + work email
              </Link>{' '}
              before creating or joining circles.
            </div>
          )}

          <div>
            <h1 className="text-xl font-bold text-foreground">Trusted circles</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Rides with circle members are boosted higher in your matches.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold">My circles</p>
            {isLoading && <p className="text-xs text-muted-foreground">Loading circles...</p>}
            {!isLoading && circles.length === 0 && (
              <p
                className="text-xs text-muted-foreground"
                data-testid="cleaner-city-circles-empty"
              >
                No circles yet - create one or join with an invite code.
              </p>
            )}
            {circles.map((c) => (
              <div
                key={c.id}
                className="rounded-xl border border-border p-3 space-y-1.5"
                data-testid="cleaner-city-circle-row"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{c.name}</p>
                  <span className="text-[10px] font-semibold uppercase text-muted-foreground">
                    {c.role}
                  </span>
                </div>
                {c.description && (
                  <p className="text-xs text-muted-foreground">{c.description}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  {c.member_count} member{c.member_count === 1 ? '' : 's'}
                </p>
                <div className="flex items-center gap-2">
                  <code className="text-[11px] rounded-lg bg-muted px-2 py-1 font-mono">
                    {c.invite_code}
                  </code>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => copyCode(c.invite_code)}
                    data-testid="cleaner-city-circle-copy-invite"
                  >
                    <Copy size={14} className="mr-1" aria-hidden />
                    Copy invite
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold">Create a circle</p>
            <div>
              <Label>Name</Label>
              <Input
                placeholder="e.g. Block C neighbours"
                value={name}
                onChange={(e) => setName(e.target.value)}
                data-testid="cleaner-city-circle-name"
              />
            </div>
            <div>
              <Label>Description (optional)</Label>
              <Input
                placeholder="Who is this for?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <Button
              onClick={create}
              disabled={!ready || createCircle.isPending || !name.trim()}
              data-testid="cleaner-city-circle-create"
            >
              <Users size={16} className="mr-1.5" aria-hidden />
              Create circle
            </Button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold">Join with invite code</p>
            <Input
              placeholder="Paste invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              data-testid="cleaner-city-circle-invite-input"
            />
            <Button
              variant="outline"
              onClick={join}
              disabled={!ready || joinCircle.isPending || !inviteCode.trim()}
              data-testid="cleaner-city-circle-join"
            >
              Join circle
            </Button>
          </div>

          <Link to="/cleaner-city" className="text-sm font-semibold text-primary block text-center">
            Back to A Cleaner City
          </Link>
        </div>
      </CleanerCityGate>
    </AppLayout>
  );
}
