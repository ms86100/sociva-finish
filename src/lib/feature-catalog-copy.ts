/** Indian RWA-facing labels for catalog keys. Keep ASCII hyphens only. */

export const FEATURE_PLAIN: Record<string, string> = {
  marketplace: 'Society marketplace',
  bulletin: 'Community board',
  smart_groups: 'Smart groups',
  conversations: 'Messages',
  disputes: 'Complaints',
  finances: 'Society accounts',
  maintenance: 'Maintenance dues',
  payment_milestones: 'Builder payments',
  visitor_management: 'Visitor passes',
  guard_kiosk: 'Guard kiosk',
  gate_entry: 'Gate QR',
  resident_identity_verification: 'Resident ID at gate',
  parcel_management: 'Parcels at the gate',
  vehicle_parking: 'Parking',
  society_notices: 'Society notices',
  domestic_help: 'Domestic help',
  helphub: 'HelpHub',
  workforce_management: 'Society workforce',
  worker_marketplace: 'Hire workers',
  worker_attendance: 'Worker attendance',
  worker_salary: 'Worker salary',
  worker_leave: 'Worker leave',
  construction_progress: 'Construction updates',
  snag_management: 'Snag list',
  inspection: 'Pre-handover inspection',
  help_requests: 'Help requests',
  delivery_management: 'Society deliveries',
  society_reports: 'Society reports',
  monthly_report_card: 'Monthly report card',
  cleaner_city: 'A Cleaner City',
  authorized_persons: 'Authorized persons',
  security_audit: 'Security audit',
};

export function featurePlainName(key: string, fallback?: string | null): string {
  return FEATURE_PLAIN[key] || fallback || key.replace(/_/g, ' ');
}

export function friendlyPackageLabel(raw: string | null | undefined): string {
  const v = (raw || '').trim();
  if (!v) return 'No package';
  const slug = v.toLowerCase().replace(/\s+/g, '_');
  if (slug === 'sociva_pilot_ops' || v === 'Sociva Pilot Ops') return 'Sociva Pilot Ops';
  if (slug.includes('core') || slug.includes('default')) return 'Sociva Core';
  return v.replace(/_/g, ' ');
}

export const PACKAGE_FLOW_COPY =
  'Catalog lists what exists. A package is the set you sell. Assign the package to a builder, then link that builder to one society. Default stays default-only - never a global blast.';
