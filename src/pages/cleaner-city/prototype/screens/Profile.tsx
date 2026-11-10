import { Link, useParams } from 'react-router-dom';
import { useProto } from '../store';
import { ProtoBtn, ProtoCard, ProtoPage, Segmented } from '../ui';
import type { ProfileSection } from '../types';

const LINKS: { id: ProfileSection; label: string; blurb: string }[] = [
  { id: 'email', label: 'Work email', blurb: 'Verified Infosys / Wipro domain' },
  { id: 'locations', label: 'Home & office', blurb: 'Corridor pins and usual road' },
  { id: 'schedule', label: 'Schedule & Autopilot', blurb: 'Week times, pause, drafts' },
  { id: 'vehicle', label: 'Vehicle & documents', blurb: 'Needed before first offer' },
  { id: 'emergency', label: 'Emergency contacts', blurb: 'Required before live rides' },
  { id: 'circles', label: 'Trusted circles', blurb: 'Invite codes and privacy' },
  { id: 'safety', label: 'Safety & blocking', blurb: 'SOS prefs and blocked riders' },
  { id: 'notifications', label: 'Notifications', blurb: 'Request, live, and reminder prefs' },
  { id: 'settings', label: 'Settings', blurb: 'Mode preference and demo reset' },
  { id: 'matrix', label: 'Feature preservation matrix', blurb: 'What moved where' },
];

export function ProfileScreen({ sectionProp }: { sectionProp?: string } = {}) {
  const params = useParams();
  const section = sectionProp ?? params.section;
  const { state, dispatch, me, matrix, hard, resetDemo } = useProto();
  const active = (section as ProfileSection) || 'overview';

  if (active === 'overview') {
    return (
      <ProtoPage>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Profile</h1>
          <p className="text-sm text-muted-foreground">One identity. Switch Find / Offer without re-onboarding.</p>
        </div>
        <ProtoCard>
          <p className="font-semibold">{me.name}</p>
          <p className="text-sm text-muted-foreground">{me.email}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            {me.rating}★ · {me.ridesDone} rides · {me.company}
          </p>
          <div className="mt-3">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Today’s intention</p>
            <Segmented
              value={state.mode}
              options={[
                { id: 'find', label: 'Find a seat' },
                { id: 'offer', label: 'Offer a seat' },
              ]}
              onChange={(id) => dispatch({ type: 'setMode', mode: id as 'find' | 'offer' })}
            />
          </div>
        </ProtoCard>
        <div className="space-y-2">
          {LINKS.map((l) => (
            <Link
              key={l.id}
              to={`/cleaner-city/prototype/profile/${l.id}`}
              className="block rounded-2xl border border-border/70 bg-card p-4 shadow-sm"
            >
              <p className="font-semibold">{l.label}</p>
              <p className="text-sm text-muted-foreground">{l.blurb}</p>
            </Link>
          ))}
        </div>
      </ProtoPage>
    );
  }

  if (active === 'matrix') {
    return (
      <ProtoPage>
        <Link to="/cleaner-city/prototype/profile" className="text-sm font-semibold text-emerald-800">
          ← Profile
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">Feature preservation</h1>
        <p className="text-sm text-muted-foreground">
          Existing capability → new IA location. Nothing removed; only relocated.
        </p>
        <div className="space-y-2">
          {matrix.map((row) => (
            <ProtoCard key={row.capability}>
              <p className="text-sm font-semibold">{row.capability}</p>
              <p className="mt-1 text-xs text-muted-foreground">UI: {row.location}</p>
              <p className="text-xs text-muted-foreground">Mock: {row.screen}</p>
              <p className="text-xs text-muted-foreground">Later hook: {row.hook}</p>
            </ProtoCard>
          ))}
        </div>
        <h2 className="pt-2 text-sm font-semibold">Hard to accommodate</h2>
        {hard.map((h) => (
          <ProtoCard key={h.item}>
            <p className="text-sm font-semibold">{h.item}</p>
            <p className="mt-1 text-xs text-muted-foreground">{h.note}</p>
          </ProtoCard>
        ))}
      </ProtoPage>
    );
  }

  const copy: Record<string, { title: string; body: string }> = {
    email: { title: 'Work email', body: `${me.email} · verified. Re-verify from here if domain changes.` },
    locations: { title: 'Home & office', body: `${me.homeLabel} → ${me.officeLabel}. Edit pins and usual Google road without leaving Profile.` },
    schedule: { title: 'Schedule & Autopilot', body: `Leave ${me.leaveTime} Mon-Fri. Pause matching. Autopilot confirm vs auto drafts tomorrow’s offer.` },
    vehicle: { title: 'Vehicle & documents', body: me.hasVehicle ? me.vehicleLabel : 'Add vehicle when you first offer seats. Document status chips remain; admin approval is separate.' },
    emergency: { title: 'Emergency contacts', body: me.emergencyOk ? 'Primary contact verified. Required before publish / live ride.' : 'Add and verify a contact to unlock live rides.' },
    circles: { title: 'Trusted circles', body: 'Create/join with invite code, travelling-tomorrow board, circle-only matching privacy toggles.' },
    safety: { title: 'Safety & blocking', body: 'SOS prefs, blocked riders, unblock. Block partner after completed rides only.' },
    notifications: { title: 'Notifications', body: 'Request alerts, live updates, Autopilot drafts, waitlist pings.' },
    settings: { title: 'Settings', body: 'Demo reset and intention defaults. Production prefs map here later.' },
  };

  const c = copy[active] || { title: 'Section', body: '' };

  return (
    <ProtoPage>
      <Link to="/cleaner-city/prototype/profile" className="text-sm font-semibold text-emerald-800">
        ← Profile
      </Link>
      <h1 className="text-xl font-semibold tracking-tight">{c.title}</h1>
      <ProtoCard>
        <p className="text-sm text-muted-foreground">{c.body}</p>
      </ProtoCard>
      {active === 'settings' ? (
        <ProtoBtn variant="secondary" className="w-full" onClick={resetDemo}>
          Reset prototype demo
        </ProtoBtn>
      ) : null}
      {active === 'vehicle' && !me.hasVehicle ? (
        <p className="text-xs text-amber-800">Switch to Arjun to see a completed vehicle profile, or add one before first Offer publish.</p>
      ) : null}
    </ProtoPage>
  );
}
