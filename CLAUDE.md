# GUUT Forms: project notes for Claude Code

MERN app: `backend/` (Express, Mongoose, ES modules) and `frontend/` (React, Vite). Render serves the built frontend from the backend (`render.yaml`).

## Commands
- Run locally: `./run.sh` or `npm --prefix backend start` (no MONGO_URI means a throwaway in-memory DB)
- Tests: `cd backend && npm install && npm test` (set `TEST_MONGO_URI=mongodb://127.0.0.1:27017` to use an existing MongoDB). Results append to `backend/tests/results.json`; `npm run test:report` prints history. Run before every deploy.
- Frontend build: `cd frontend && npm install && npm run build`

## Architecture
- Platform DB: accounts, companies, teams, FormIndex (directory and access), logs, token usage. Tenant DB (hosted `guut_hosted` or a company's own): Form and Submission.
- Roles: superadmin, admin, user. Company types: individual, business. Membership: active, pending, declined.
- Open teams: `Team.open` (individuals, any account by email); share entries carry `external`. Listing approval: `FormIndex.listing`. Importer: `backend/utils/importer.js`. AI key order: own key, then `PLATFORM_AI_KEY` while free credit lasts (`resolveAi`).
- Access: `backend/utils/access.js` (owner, admin, editor, viewer; collaborators and team shares; highest role wins).
- Email verification is off unless `REQUIRE_EMAIL_VERIFICATION=true`.
- Billing: `backend/utils/plans.js`, placeholder prices; `ENFORCE_BILLING` off by default.
- Frontend: hash routing in `App.jsx`, sidebar in `components/Sidebar.jsx`, logo in `components/Logo.jsx` (CSS variables `--logo-ink`, `--logo-sub`, `--logo-dot`).

## Rules
- Portability: avoid `$pull`, `$dateToString`, `$max` and grouped `$sum:1` in Mongo queries; aggregate in JS.
- Never store form answers in notification emails (counts and links only).
- No emojis or em dashes in UI text or docs.

## Deferred
Dynamic routing, submission status tracking, workflow automation. Real SMTP and real AI key paths are untested against live services (see SETUP.md go-live checklist).
