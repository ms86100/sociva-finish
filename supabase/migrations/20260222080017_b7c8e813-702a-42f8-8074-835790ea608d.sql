-- Add showcase fields to platform_features for fully dynamic feature descriptions
ALTER TABLE public.platform_features
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS audience text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS capabilities text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS route text,
  ADD COLUMN IF NOT EXISTS icon_name text;

-- Populate with initial data for all 18 features
UPDATE public.platform_features SET
  tagline = 'Buy & sell within your community',
  audience = ARRAY['Resident', 'Seller', 'Society Admin'],
  capabilities = ARRAY['Product catalog with categories', 'Cart & multi-vendor checkout', 'Order tracking & status updates', 'Seller verification & analytics', 'Cross-community selling'],
  route = '/',
  icon_name = 'ShoppingCart'
WHERE feature_key = 'marketplace';

UPDATE public.platform_features SET
  tagline = 'Society discussions, polls & events',
  audience = ARRAY['Resident', 'Society Admin', 'Moderator'],
  capabilities = ARRAY['Posts with categories & attachments', 'Polls with deadlines', 'Event RSVPs', 'Comment threads & upvotes', 'Pin & archive posts'],
  route = '/community',
  icon_name = 'MessageSquare'
WHERE feature_key = 'bulletin';

UPDATE public.platform_features SET
  tagline = 'Track and resolve community issues',
  audience = ARRAY['Resident', 'Society Admin'],
  capabilities = ARRAY['Photo evidence uploads', 'SLA deadline tracking', 'Anonymous reporting option', 'Committee notes & resolution', 'Category-based routing'],
  route = '/disputes',
  icon_name = 'Scale'
WHERE feature_key = 'disputes';

UPDATE public.platform_features SET
  tagline = 'Transparent expense tracking',
  audience = ARRAY['Resident', 'Society Admin', 'Treasurer'],
  capabilities = ARRAY['Expense recording with receipts', 'Income vs expense charts', 'Spending pie charts by category', 'Resident expense flagging', 'Transparency dashboard'],
  route = '/society/finances',
  icon_name = 'IndianRupee'
WHERE feature_key = 'finances';

UPDATE public.platform_features SET
  tagline = 'Tower-wise construction tracking',
  audience = ARRAY['Resident', 'Builder', 'Society Admin'],
  capabilities = ARRAY['Tower-wise progress tracking', 'Photo milestone updates', 'Expected vs revised dates', 'RERA document vault', 'Project Q&A board'],
  route = '/society/progress',
  icon_name = 'Building2'
WHERE feature_key = 'construction_progress';

UPDATE public.platform_features SET
  tagline = 'Report and track construction defects',
  audience = ARRAY['Resident', 'Builder', 'Society Admin'],
  capabilities = ARRAY['Photo-based snag reporting', 'Priority & category tagging', 'Builder acknowledgment flow', 'Collective escalation system', 'Fix verification by resident'],
  route = '/society/snags',
  icon_name = 'Bug'
WHERE feature_key = 'snag_management';

UPDATE public.platform_features SET
  tagline = 'Neighbor-to-neighbor assistance',
  audience = ARRAY['Resident'],
  capabilities = ARRAY['Tagged help categories', 'Auto-expiring requests', 'Response tracking', 'Community goodwill building', 'Quick post creation'],
  route = '/community',
  icon_name = 'HelpCircle'
WHERE feature_key = 'help_requests';

UPDATE public.platform_features SET
  tagline = 'Gate entry & visitor tracking',
  audience = ARRAY['Resident', 'Security Guard', 'Society Admin'],
  capabilities = ARRAY['QR-based visitor passes', 'Real-time entry notifications', 'Resident confirmation flow', 'Entry log history', 'Denied entry tracking'],
  route = '/gate-entry',
  icon_name = 'DoorOpen'
WHERE feature_key = 'visitor_management';

UPDATE public.platform_features SET
  tagline = 'Maid, cook & driver management',
  audience = ARRAY['Resident', 'Security Guard', 'Society Admin'],
  capabilities = ARRAY['Live photo registration', 'Shift & schedule validation', 'Flat assignment management', 'Gate entry attendance tracking', 'Worker status management'],
  route = '/domestic-help',
  icon_name = 'Users'
WHERE feature_key = 'domestic_help';

UPDATE public.platform_features SET
  tagline = 'Track deliveries at the gate',
  audience = ARRAY['Resident', 'Security Guard'],
  capabilities = ARRAY['Parcel logging at gate', 'Resident notifications', 'Uncollected parcel alerts', 'Pickup confirmation', 'Delivery history'],
  route = '/parcels',
  icon_name = 'Package'
WHERE feature_key = 'parcel_management';

UPDATE public.platform_features SET
  tagline = 'Flat handover inspection',
  audience = ARRAY['Resident', 'Builder', 'Inspector'],
  capabilities = ARRAY['Room-wise checklists', 'Photo documentation', 'Issue severity marking', 'Digital sign-off', 'Report generation'],
  route = '/inspection',
  icon_name = 'ClipboardCheck'
WHERE feature_key = 'inspection';

UPDATE public.platform_features SET
  tagline = 'Track construction-linked payments',
  audience = ARRAY['Resident', 'Builder'],
  capabilities = ARRAY['Milestone-linked payments', 'Due date reminders', 'Payment history', 'Completion verification', 'Receipt tracking'],
  route = '/payment-milestones',
  icon_name = 'Landmark'
WHERE feature_key = 'payment_milestones';

UPDATE public.platform_features SET
  tagline = 'Society maintenance requests',
  audience = ARRAY['Resident', 'Society Admin', 'Maintenance Staff'],
  capabilities = ARRAY['Request submission with photos', 'Priority assignment', 'Status tracking', 'Assignment to staff', 'Resolution history'],
  route = '/maintenance',
  icon_name = 'Wrench'
WHERE feature_key = 'maintenance';

UPDATE public.platform_features SET
  tagline = 'Security guard dashboard',
  audience = ARRAY['Security Guard', 'Society Admin'],
  capabilities = ARRAY['QR & OTP verification', 'Worker pass validation', 'Parcel logging', 'Emergency alerts', 'Shift-based access'],
  route = '/guard-kiosk',
  icon_name = 'Shield'
WHERE feature_key = 'guard_kiosk';

UPDATE public.platform_features SET
  tagline = 'Parking slot management',
  audience = ARRAY['Resident', 'Security Guard', 'Society Admin'],
  capabilities = ARRAY['Slot assignment', 'Vehicle registration', 'Visitor parking passes', 'Violation reporting', 'Parking history'],
  route = '/vehicle-parking',
  icon_name = 'Car'
WHERE feature_key = 'vehicle_parking';

UPDATE public.platform_features SET
  tagline = 'Identity verification for residents',
  audience = ARRAY['Resident', 'Society Admin'],
  capabilities = ARRAY['Document upload', 'Admin review workflow', 'Approval/rejection flow', 'Verified badge display', 'Re-verification requests'],
  route = '/security-verify',
  icon_name = 'UserCheck'
WHERE feature_key = 'resident_identity_verification';

UPDATE public.platform_features SET
  tagline = 'Hire skilled workers from your community',
  audience = ARRAY['Resident', 'Worker'],
  capabilities = ARRAY['Job posting & browsing', 'Worker profiles & ratings', 'Job acceptance flow', 'Completion & review', 'Skill-based matching'],
  route = '/worker-hire',
  icon_name = 'Briefcase'
WHERE feature_key = 'worker_marketplace';

UPDATE public.platform_features SET
  tagline = 'Manage society workers & contractors',
  audience = ARRAY['Society Admin', 'Security Guard', 'Builder'],
  capabilities = ARRAY['Worker registration with live photo', 'Shift & schedule management', 'Gate entry validation', 'Flat assignment tracking', 'Rating & performance history'],
  route = '/workforce',
  icon_name = 'HardHat'
WHERE feature_key = 'workforce_management';
