// @ts-nocheck
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Copy } from 'lucide-react';
import { AppLayout } from '@/components/layout/AppLayout';
import { CleanerCityGate } from '@/components/cleaner-city/CleanerCityGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  useCircleInvites,
  useCircleMembers,
  useCircleTomorrow,
  useCleanerCityProfile,
  useCleanerCityWorkVerification,
  useCreateCircle,
  useInviteToCircle,
  useJoinCircle,
  useLeaveCircle,
  useMyCircles,
  useRemoveCircleMember,
  useRespondCircleInvite,
  useRotateCircleInvite,
  useCircleChat,
  useSendCircleChat,
  useSetCirclePrefs,
} from '@/hooks/queries/useCleanerCity';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export default function CleanerCityCirclesPage() {
  const { data: profile } = useCleanerCityProfile();
  const { data: verification } = useCleanerCityWorkVerification();
  const { data: circles = [], isLoading } = useMyCircles();
  const createCircle = useCreateCircle();
  const joinCircle = useJoinCircle();
  const leaveCircle = useLeaveCircle();
  const rotateInvite = useRotateCircleInvite();
  const invites = useCircleInvites();
  const respondInvite = useRespondCircleInvite();
  const setPrefs = useSetCirclePrefs();

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
      toast.success('Circle created - invite expires in 14 days');
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
      toast.error(e?.message || 'Invalid or expired invite code');
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

  const leave = async (circleId: string) => {
    try {
      await leaveCircle.mutateAsync(circleId);
      toast.success('Left circle');
    } catch (e: any) {
      toast.error(e?.message || 'Could not leave circle');
    }
  };

  const rotate = async (circleId: string) => {
    try {
      await rotateInvite.mutateAsync(circleId);
      toast.success('Invite code rotated - previous code no longer works');
    } catch (e: any) {
      toast.error(e?.message || 'Could not rotate invite');
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
              Rides with circle members are boosted higher in your matches. Invite codes are
              private to owners and expire after 14 days.
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
                {c.role === 'owner' && c.invite_code && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => rotate(c.id)}
                        disabled={rotateInvite.isPending}
                        data-testid="cleaner-city-circle-rotate-invite"
                      >
                        Rotate code
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {c.invite_expired
                        ? 'Invite expired - rotate to issue a new code'
                        : c.invite_expires_at
                          ? `Expires ${new Date(c.invite_expires_at).toLocaleString()}`
                          : 'Invite expires in 14 days from creation or rotation'}
                    </p>
                  </div>
                )}
                <CircleTools
                  circleId={c.id}
                  isOwner={c.role === 'owner'}
                  societyId={profile?.society_id}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => leave(c.id)}
                  disabled={leaveCircle.isPending}
                  data-testid="cleaner-city-circle-leave"
                >
                  Leave circle
                </Button>
              </div>
            ))}
          </div>

          {profile && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-2" data-testid="cleaner-city-circle-prefs">
              <p className="text-sm font-semibold">Circle privacy</p>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!!profile.circle_only_matching}
                  onChange={(e) =>
                    setPrefs.mutate({
                      circle_only: e.target.checked,
                      visibility: profile.circle_visibility || 'members',
                      show_on_board: !!profile.show_on_circle_board,
                      require_circle_history: !!profile.require_circle_history,
                      open_city: !!profile.open_city_matching,
                    })
                  }
                />
                Only match people in my circles
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={profile.circle_visibility !== 'private'}
                  onChange={(e) =>
                    setPrefs.mutate({
                      circle_only: !!profile.circle_only_matching,
                      visibility: e.target.checked ? 'members' : 'private',
                      show_on_board: !!profile.show_on_circle_board,
                      require_circle_history: !!profile.require_circle_history,
                      open_city: !!profile.open_city_matching,
                    })
                  }
                />
                Let circle members see that I published a commute
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!!profile.show_on_circle_board}
                  onChange={(e) =>
                    setPrefs.mutate({
                      circle_only: !!profile.circle_only_matching,
                      visibility: profile.circle_visibility || 'members',
                      show_on_board: e.target.checked,
                      require_circle_history: !!profile.require_circle_history,
                      open_city: !!profile.open_city_matching,
                    })
                  }
                />
                Show me on the tomorrow board
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!!profile.require_circle_history}
                  onChange={(e) =>
                    setPrefs.mutate({
                      circle_only: !!profile.circle_only_matching,
                      visibility: profile.circle_visibility || 'members',
                      show_on_board: !!profile.show_on_circle_board,
                      require_circle_history: e.target.checked,
                      open_city: !!profile.open_city_matching,
                    })
                  }
                />
                Only circles, and only hosts with two completed rides
              </label>
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={!!profile.open_city_matching}
                  onChange={(e) =>
                    setPrefs.mutate({
                      circle_only: !!profile.circle_only_matching,
                      visibility: profile.circle_visibility || 'members',
                      show_on_board: !!profile.show_on_circle_board,
                      require_circle_history: !!profile.require_circle_history,
                      open_city: e.target.checked,
                    })
                  }
                />
                Also match people outside my societies when they opted in too
              </label>
            </div>
          )}

          {(invites.data || []).length > 0 && (
            <div className="rounded-2xl border border-border bg-card p-4 space-y-2" data-testid="cleaner-city-circle-invites">
              <p className="text-sm font-semibold">Invitations</p>
              {(invites.data || []).map((invite) => (
                <div key={invite.id} className="flex items-center justify-between gap-2">
                  <p className="text-xs">{invite.circle_name}</p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => respondInvite.mutate({ invite_id: invite.id, accept: true })}>
                      Accept
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => respondInvite.mutate({ invite_id: invite.id, accept: false })}>
                      Decline
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

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
              Create circle
            </Button>
          </div>

          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <p className="text-sm font-semibold">Join with invite code</p>
            <Input
              placeholder="Paste invite code"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              data-testid="cleaner-city-circle-join-code"
            />
            <Button
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

function CircleTools({
  circleId,
  isOwner,
  societyId,
}: {
  circleId: string;
  isOwner: boolean;
  societyId?: string;
}) {
  const { user } = useAuth();
  const { data: members = [] } = useCircleMembers(circleId);
  const { data: tomorrow = [] } = useCircleTomorrow(circleId);
  const removeMember = useRemoveCircleMember();
  const invite = useInviteToCircle();
  const [phone, setPhone] = useState('');
  const [chatBody, setChatBody] = useState('');
  const { data: chat = [] } = useCircleChat(circleId);
  const sendChat = useSendCircleChat();

  const inviteByPhone = async () => {
    try {
      const { data, error } = await supabase.rpc('cleaner_city_resolve_emergency_notify_user', {
        p_phone: phone.trim(),
      });
      if (error) throw error;
      if (!data) {
        toast.error('No Sociva neighbour with that phone. Share the invite code instead.');
        return;
      }
      await invite.mutateAsync({ circle_id: circleId, invitee: data });
      toast.success('Invitation sent');
      setPhone('');
    } catch (e: any) {
      toast.error(e?.message || 'Could not invite');
    }
  };

  return (
    <div className="space-y-2 pt-1" data-testid="cleaner-city-circle-members">
      {members.map((m) => (
        <div key={m.user_id} className="flex items-center justify-between gap-2 text-xs">
          <span>
            {m.display_name} · {m.role}
          </span>
          {isOwner && m.user_id !== user?.id && m.role !== 'owner' && (
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => removeMember.mutate({ circle_id: circleId, member_user_id: m.user_id })}
            >
              Remove
            </Button>
          )}
        </div>
      ))}
      <div className="space-y-1" data-testid="cleaner-city-circle-chat">
        <p className="text-[11px] font-semibold">Circle chat</p>
        {chat.slice(-6).map((row) => (
          <p key={row.id} className="text-[11px] text-muted-foreground">
            {row.sender_id === user?.id ? 'You' : 'Member'}: {row.body}
          </p>
        ))}
        <div className="flex gap-2">
          <Input
            value={chatBody}
            onChange={(e) => setChatBody(e.target.value)}
            placeholder="Message the circle"
            className="h-8"
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!societyId || !chatBody.trim() || sendChat.isPending}
            onClick={async () => {
              try {
                await sendChat.mutateAsync({
                  circle_id: circleId,
                  society_id: societyId,
                  body: chatBody,
                });
                setChatBody('');
              } catch (e: any) {
                toast.error(e?.message || 'Could not send');
              }
            }}
          >
            Send
          </Button>
        </div>
      </div>
      <div data-testid="cleaner-city-circle-tomorrow">
        <p className="text-[11px] font-semibold">Travelling tomorrow</p>
        {tomorrow.length === 0 && (
          <p className="text-[11px] text-muted-foreground">No opted-in members have a published commute tomorrow.</p>
        )}
        {tomorrow.map((row, i) => (
          <p key={`${row.display_name}-${i}`} className="text-[11px] text-muted-foreground">
            {row.display_name} · {String(row.depart_time || '').slice(0, 5)} · {String(row.direction || '').replace('_', ' ')} · {row.origin_label} to {row.destination_label}
          </p>
        ))}
      </div>
      {isOwner && (
        <div className="flex gap-2">
          <Input placeholder="Neighbour phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Button size="sm" variant="outline" onClick={inviteByPhone} disabled={!phone.trim() || invite.isPending}>
            Invite
          </Button>
        </div>
      )}
    </div>
  );
}
