# Sociva integration environment

Isolated stack for `feat/onboarding-domain-reach`. **Do not deploy this work to www.sociva.in / sociva-finish production until an explicit merge go-ahead.**

## Git

- Branch: `feat/onboarding-domain-reach`
- Remote: `origin/feat/onboarding-domain-reach`

## Supabase

| Role | Project | Ref |
|---|---|---|
| Production (do not touch for this work) | Sociva | `kkzkuyhgdvyecmxtmkpy` |
| Integration (use this) | Branch `onboarding-integration` | `hfeuskcehglyqllvrxyu` |
| Spare empty project | sociva-integration | `twnhqhkfcniffyjluryp` |

Integration URL: `https://hfeuskcehglyqllvrxyu.supabase.co`

## Frontend env (integration only)

Copy from `docs/env.integration.example` to `.env.integration.local`, or set on the Vercel **sociva-integration** project:

```
VITE_SUPABASE_URL=https://hfeuskcehglyqllvrxyu.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon key from integration project>
```

Never put these keys on the production `sociva-finish` Vercel project.

## Vercel

Project: `sociva-integration`  
URL: https://sociva-integration.vercel.app  
Deploy with: `vercel deploy --prod --yes --project sociva-integration`  
Local `.vercel/project.json` must stay linked to **sociva-finish** (production).  
Do **not** run `vercel --prod` against `sociva-finish` for this feature.

## Feature under test

Become a Seller Step 1 sub-flow:

1. Product / Service / Listing  
2. Cart / Contact / Book (filtered by domain)  
3. Matching categories  

Salon + Contact is allowed when taxonomy lists `contact_seller` for that category.
