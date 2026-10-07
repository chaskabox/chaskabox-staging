# READ THIS FIRST — ChaskaBox Muse Staging Candidate v4

This directory is the deployable root.

Authoritative handoff files:
1. `VERSION.txt`
2. `MUSE_FINAL_DEPLOYMENT_TASKS.md`
3. `FINAL_AUDIT_REPORT_20261007.md`
4. `AI_FREE_IMPLEMENTATION.md`
5. `FREE_TOOLING_MATRIX.md`

The `reports/` directory contains older implementation history/reference material and must NOT override the root handoff documents above.

Rules:
- NON-PRODUCTION staging first.
- Free tools/free tiers only. Do not add a paid provider.
- Do not redesign or broadly refactor.
- Apply only missing DB migrations, in order `001` through `018`.
- Treat migration `016` as security-critical: it removes the unsafe legacy hard-delete RPC and hardens settings/RLS helper functions.
- Treat migration `017` as notification-reliability-critical.
- Treat migration `018` as public-surface hardening.
- Core checkout/auth/order/security behavior must work with AI disabled or unavailable.
- Do not deploy production until all critical staging checks pass and the owner explicitly says `APPROVE PRODUCTION DEPLOYMENT`.
