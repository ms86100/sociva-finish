# Sociva Feature Roadmap

STATUS KEY: [ ] Todo  [~] In Progress  [x] Done

---

## FEATURE 1: COMMUNITY BULLETIN BOARD
[x] Database tables: bulletin_posts, bulletin_comments, bulletin_votes, bulletin_rsvps
[x] RLS policies (society-scoped)
[x] Realtime subscription for new posts
[x] BulletinPage with category tabs (Event/Alert/Maintenance/Poll/Lost & Found)
[x] CreatePostSheet with category picker + attachments
[x] PostCard component with vote/comment/RSVP actions
[x] Poll system with deadline + results visualization
[x] RSVP system with attendee count
[x] Attachment support (images via storage bucket)
[x] Society-level pinning (admin only) — DB ready, admin UI toggle needed
[x] "Most Discussed Today" highlight section
[x] Search and filter within bulletin
[x] Bottom nav integration (new "Community" tab)
[x] PostDetailSheet with comments, polls, RSVP
[x] Auto-archive after 30 days (cron edge function) — daily at 3 AM
[x] AI summary for long threads (Lovable AI via summarize-thread edge function)

## FEATURE 2: QUICK HELP REQUESTS (SOS)
[x] Database table: help_requests, help_responses
[x] RLS policies (society-scoped, private responses)
[x] CreateHelpSheet (create with tags: Borrow/Emergency/Question/Offer)
[x] Help feed as tab within Community page
[x] Auto-expiry (handled by auto-archive-bulletin cron)
[x] Private response system (only requester sees responders via RLS)
[x] Push notification for new requests in society

## FEATURE 3: RECURRING SUBSCRIPTIONS
[x] Database tables: subscriptions, subscription_deliveries
[x] RLS policies for subscriptions
[x] SubscriptionSheet component (create)
[x] Buyer: My Subscriptions page (/subscriptions)
[x] Auto-order generation edge function (daily cron at 5 AM)
[x] Pause/Resume/Cancel functionality
[ ] Buyer: Subscribe button on seller product cards (needs integration in ProductCard)
[ ] Seller: Subscription management view in dashboard
[ ] Push notification for delivery reminders

## FEATURE 4: COMMUNITY TRUST DIRECTORY
[x] Database table: skill_listings, skill_endorsements
[x] RLS policies (society-scoped)
[x] TrustDirectoryPage with search (/directory)
[x] SkillCard component with trust score
[x] Endorsement/recommendation system
[x] Integration with existing seller reviews for trust scoring
[x] Profile badge display on profile pages

## ROUTES ADDED
- /community — Bulletin Board + Quick Help tabs
- /subscriptions — My Subscriptions page
- /directory — Community Trust Directory

## EDGE FUNCTIONS DEPLOYED
- auto-archive-bulletin — daily cron, archives 30-day posts + expires help requests
- summarize-thread — AI summary via Lovable AI (Gemini 3 Flash)
- process-subscriptions — daily cron, auto-generates orders for active subscriptions
- notify-help-request — sends push notifications to society members on new help requests

## REMAINING WORK (nice-to-haves)
- Subscribe button on ProductCard component
- Seller subscription management dashboard tab
- Push notifications for subscription delivery reminders
- Admin UI for pinning bulletin posts
