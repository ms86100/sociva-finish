# Sociva Analytics Event Dictionary (v1 + journey v2)

Source of truth for product behaviour events sent via `src/lib/analytics.ts` → Amplitude.

Typed names live in `src/lib/analytics-events.ts`. Journey helpers: `src/lib/analytics-journey.ts`.

Orders, payments, refunds, and credits remain authoritative in Supabase; Amplitude only receives mirrored behavioural events.

Taxonomy vocabulary (docs) maps to snake_case event names in code, e.g. `SELLER_ONBOARDING_STEP_STARTED` → `seller_onboarding_step_started`.

## Env

| Variable | Purpose |
|---|---|
| `VITE_AMPLITUDE_API_KEY` | Browser write key (public). Empty = analytics no-ops. |
| `VITE_AMPLITUDE_DASHBOARD_URL` | Optional Command Center deep link to Amplitude project. |

Use a **staging** Amplitude project first. Production key only after Session Replay masking + Settings privacy toggle are verified.

## Identity & privacy

- Until login: anonymized device id.
- On auth success: `identify(userId, { society_id, role flags })`.
- On logout: `reset()` (also clears push attribution bag).
- Session Replay: Settings → Privacy opt-in (default **off**). User property `replay_opt_in`. Sample ~10% of opted-in sessions. Inputs/payment UI masked.
- Never send OTP, passwords, full phone, card/UPI, or raw address lines. Prefer IDs, enums, lengths (`intent_phrase_len`), and error **codes**.

## Attribution bag

`setAttribution({ campaign_id, queue_item_id, … })` merges into subsequent `track()` props for 30 minutes (push → product → checkout → order). Cleared on logout.

## Events

### Lifecycle
| Event | When |
|---|---|
| `app_opened` | App bootstrap after `initAnalytics` |
| `page_viewed` | Route change (`path`) |

### Auth
| Event | When |
|---|---|
| `login_started` | OTP / login flow start |
| `login_completed` | Auth success |
| `logout` | Sign out |

### Search
| Event | When | Key props |
|---|---|---|
| `search_submitted` | User commits a search | `search_term`, `source` |
| `search_results_viewed` | Results rendered | `result_count` |
| `search_no_results` | Zero results | `search_term` |
| `search_result_clicked` | Result tap | `product_id`, `position`, `source` |

Also writes Supabase `search_demand_log` / `log_committed_search` (unchanged).

### Product
| Event | When | Key props |
|---|---|---|
| `product_viewed` | Product detail open | `product_id`, `source`, `position` |
| `product_impression` | Card in viewport (dual-write) | same |
| `product_clicked` | Card tap (dual-write) | same |
| `product_list_viewed` | List mount | `source` |
| `seller_viewed` | Store page | `seller_id` |
| `wishlist_toggled` | Favorite on/off | `product_id`, `on` |

### Cart & checkout
| Event | When | Key props |
|---|---|---|
| `add_to_cart` / `remove_from_cart` / `quantity_changed` | Cart mutations | `product_id`, `source`, `position` |
| `cart_opened` | Cart page mount | |
| `checkout_started` | Checkout begin | |
| `payment_started` / `payment_success` / `payment_failed` | Razorpay path (mirror only) | |
| `order_completed` | Order placed successfully | `order_id` |

### Seller ops (v1)
| Event | When | Key props |
|---|---|---|
| `seller_onboarding_started` | Become-seller open | `force_new`, `resume` |
| `seller_onboarding_completed` | Store submitted for review | `seller_id` |
| `product_created` / `product_updated` | Live seller product save (post-onboarding) | `product_id`, `seller_id` |
| `seller_dashboard_opened` | Seller dashboard mount | `seller_id`, `portfolio` |
| `order_accepted` / `order_rejected` | Seller inbox status action | `order_id`, `seller_id` |

### Seller onboarding journey (v2)

Real Become Seller flow is **v5 / 4 steps** (`flow_version: '5'`):

| Step | `step_key` | UI |
|---|---|---|
| 1 | `intent_category` | Intent + category (commerce model inferred) |
| 2 | `subcategory` | Subcategory select / propose |
| 3 | `listing` | Draft product/service/listing |
| 4 | `store_submit` | Store name + declaration + submit |

| Event | When | Key props |
|---|---|---|
| `seller_onboarding_step_started` | Enter step | `step`, `step_key`, `seller_id` |
| `seller_onboarding_step_completed` | Continue / advance | same |
| `seller_onboarding_step_abandoned` | Save & exit or leave mid-flow | `reason` |
| `seller_onboarding_step_back` | Back navigation | `from_step`, `to_step` |
| `seller_onboarding_step_error` | Submit / save failure | `error_code` |
| `seller_onboarding_validation_failed` | Blocked continue | `error_code`, `field` |
| `seller_intent_captured` | Intent phrase present on step 1 continue | `intent_phrase_len` (not raw text) |
| `seller_category_selected` | Category chosen | `category` |
| `seller_commerce_model_selected` | Model inferred / set | `commerce_model` |
| `seller_commerce_model_changed` | Model differs from prior | `from`, `to` |
| `seller_subcategory_selected` | Step 2 continue | `subcategory_id` |
| `seller_listing_draft_created` | Draft listing saved in onboarding | `product_id`, `seller_id` |

### Push (client)

| Event | When | Key props |
|---|---|---|
| `push_notification_received` | Foreground receive | `queue_item_id`, `campaign_id`, `notification_type` |
| `push_notification_opened` | Notification tap | same + `route` |
| `app_opened_from_push` | Cold/warm open attributed to push | same |
| `push_action_clicked` | In-app toast View / action | `action` |

Server `push_sent` / `push_delivered` → Amplitude HTTP is deferred.

## Dual-write

`useCardAnalytics` continues writing `marketplace_events` for DemandInsights / admin tables, and also calls `analytics.track` for impressions/clicks/wishlist.

## Admin Product Intelligence

Command Center → **Intelligence** tab:

- Deep links to Amplitude (First Order, Seller Onboarding, Push→Order, Cart drop-off).
- Top searches from `search_demand_log` / `get_unmet_demand` (Supabase-native).

## Deferred

`product_image_viewed`, `description_expanded`, Firebase dual-sink, server push_sent/delivered, in-app Seller Health timeline warehouse.
