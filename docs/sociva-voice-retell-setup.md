# Talk to Sociva - Retell setup

This is the website voice flow at `/#/talk-to-sociva`. Visitors are not logged in. They fill name, phone, and society, then talk to Sociva. The Sociva team reviews the conversation in admin and sets up the store.

Do not use the Retell share/orb URL in the product. Rotate any token that was pasted into chat.

## Retell dashboard

1. Keep agent `agent_4030de35bb0d6ea3470242ceef`.
2. Change the agent prompt so it introduces itself as Sociva's AI assistant, not Riya.
3. Allowed domains for web calls: `localhost`, `sociva.in`, `www.sociva.in`.
4. Create an API key and store it only as a Supabase Edge Function secret named `RETELL_API_KEY`.
5. Store the agent id as Edge Function secret `RETELL_AGENT_ID`.
6. Optional Vault keys with the same names: `retell_api_key`, `retell_agent_id`.

White-label / hide Retell branding only if your Retell plan includes it. Sociva chrome around the custom call UI is the product branding either way.

## Supabase secrets

Set these on the project. Do not put them in `VITE_*` or frontend code.

```
RETELL_API_KEY=replace_me
RETELL_AGENT_ID=agent_4030de35bb0d6ea3470242ceef
```

## Deploy

1. Apply migration `20261021180000_seller_interest_leads.sql`.
2. Deploy Edge Functions `start-sociva-voice-call` and `get-sociva-voice-call`.
3. Open `https://www.sociva.in/#/talk-to-sociva` on HTTPS (or localhost).
4. Allow the microphone, complete a short call, then open Admin -> Talk to Sociva.

## Manual test checklist

- Unauthenticated website visitor can open `/talk-to-sociva` without logging in.
- Invalid name, phone, or society is rejected before a Retell call starts.
- Mic deny shows an error and does not claim the store was created.
- Mute and end call work.
- After the call, the thank-you screen says the team will set up the store.
- Admin lead list shows name, phone, and society only (no copied transcript table).
- Admin conversation pane loads transcript/summary/recording from Retell.
- A second webhook or agent-schema change in Retell does not require a Sociva migration.
- Existing `/become-seller` wizard still works.
- Frontend bundle and these files contain no `RETELL_API_KEY` and no share token.

## Rollback

Remove the `/talk-to-sociva` and `/admin/seller-interest` routes, undeploy the two Edge Functions, and leave `seller_interest_leads` in place (it does not affect checkout). To hide the feature quickly, unset `RETELL_API_KEY` so start-call returns 503.
