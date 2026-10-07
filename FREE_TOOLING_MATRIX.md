# ChaskaBox Free / Free-Tier Tooling

| Need | Selected approach | Paid dependency required? |
|---|---|---|
| Hosting / Functions | Existing Cloudflare Pages/Workers | No paid tool required for candidate |
| Database/Auth/RLS/Realtime | Supabase | Free tier initially |
| Bot protection | Cloudflare Turnstile | Free |
| WhatsApp | Self-hosted WAHA | No Meta/Twilio paid provider required |
| Transactional email | Resend optional | Free tier initially; optional |
| Web performance analytics | Cloudflare Web Analytics | Free |
| UX recordings/heatmaps | Microsoft Clarity optional | Free; privacy exclusions/masking required |
| Notification retry | Postgres outbox + scheduled Cloudflare Worker | No separate paid queue/SaaS required |
| Backups | Included workflow template; destination chosen by owner | Can use free-tier storage within provider limits |
| Admin CMS/operations | Built-in ChaskaBox admin | No separate CMS/CRM subscription |
| Admin/customer AI | Cloudflare Workers AI binding | Free daily allocation; AI is optional/fallback-safe |
| Semantic search | Workers AI embeddings + Supabase pgvector | No paid vector DB required |

## AI free-tier policy
This candidate intentionally has **no external paid AI provider dependency**. It uses the Cloudflare Workers AI binding named `AI` and allow-listed Cloudflare-hosted models. If the free daily allocation/capacity is exhausted, AI features degrade gracefully and core commerce remains operational.

Do not add Shopify plugins, paid CRM, paid push provider, paid analytics, Twilio/Meta WhatsApp paid integration, or a paid AI service merely to deploy this version.
