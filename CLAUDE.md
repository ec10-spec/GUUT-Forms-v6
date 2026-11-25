# GUUT Forms: project notes for Claude Code

MERN app: `backend/` (Express, Mongoose, ES modules) and `frontend/` (React, Vite). The Express app is `backend/app.js` (exports `app` and `init()`). Two ways to run it:
- Vercel (primary): `vercel.json`; static frontend from `frontend/dist`; all `/api/*` goes to one function `api/index.js` -> `backend/vercel.js`. No timers on Vercel: fire-and-forget work must go through `utils/background.js` (`waitUntil`), scheduled work through `/api/cron/tick` (`routes/cron.js`, needs `CRON_SECRET`). Request bodies are capped at 4.5 MB by Vercel (uploads 4 MB, imports 3 MB).
- Long-running server: `backend/server.js` (local, Render via `render.yaml`) serves the built frontend and runs the timers.

## Commands
- Run locally: `./run.sh` or `npm --prefix backend start` (no MONGO_URI means a throwaway in-memory DB)
- Tests: `cd backend && npm install && npm test` (set `TEST_MONGO_URI=mongodb://127.0.0.1:27017` to use an existing MongoDB). Results append to `backend/tests/results.json`; `npm run test:report` prints history. Run before every deploy. `npx vercel build` checks the Vercel build locally.
- Frontend build: `cd frontend && npm install && npm run build`

## Architecture
- Platform DB: accounts, companies, teams, FormIndex (directory and access), logs, token usage. Tenant DB (hosted `guut_hosted` or a company's own): Form and Submission.
- Roles: superadmin, admin, user. Company types: individual, business. Membership: active, pending, declined.
- Open teams: `Team.open` (individuals, any account by email); share entries carry `external`. Listing approval: `FormIndex.listing`. Importer: `backend/utils/importer.js`. AI key order: own key, then `PLATFORM_AI_KEY` while free credit lasts (`resolveAi`).
- Access: `backend/utils/access.js` (owner, admin, editor, viewer; collaborators and team shares; highest role wins).
- Email verification is off unless `REQUIRE_EMAIL_VERIFICATION=true`.
- Billing: `backend/utils/plans.js`, placeholder prices; `ENFORCE_BILLING` off by default.
- Answers: one validator, `backend/utils/answers.js` (copied to `frontend/src/lib/answers.js`; a test keeps them identical). Used by submissions, the importer and analytics. Conditional logic (`showIf: { fieldId, op: eq|in|lte|gte, values }`) lives there too.
- Files: respondents' uploads and header images are GridFS files in the tenant DB (`utils/uploads.js`, buckets `uploads` and `assets`), never inside documents. Saved AI chats: `AnalysisChat` in the tenant DB.
- Dates: group by the viewer's IANA zone (`utils/time.js`); the client sends `tz`.
- Sessions: JWTs carry `tokenVersion`; `User.setPasswordHash()` bumps it. Platform DB name: `PLATFORM_DB_NAME` (see `choosePlatformDbName`). AI cost: `utils/pricing.js`.
- GUUT AI: `routes/assistant.js` + `components/GuutAssistant.jsx`. Replies are JSON `{ reply, actions }`; actions are re-checked on the server (`cleanActions`, `cleanEditFields` keeps question ids). The builder reports its state with the `guut:builder-state` event and applies edits on `guut:assistant-apply`. History: `AssistantChat` (tenant DB), off when `settings.assistantSaveHistory` is false.
- Sign-in providers: `routes/oauth.js` (Google, Microsoft, Apple; OIDC code flow, state + cookie nonce, 2-minute ticket swapped at `/exchange`). `User.oauth.<provider>` holds the provider's id; `User.passwordSet` false = no password yet.
- Team reviewers: `Team.members[].role` (member, reviewer); `FormIndex.review` (status none, requested, approved, changes_requested); routes in `routes/sharing.js`.
- Pricing: Freemium, Teams (`starter`), Servers (`scale`); `growth` retired. `POST /api/auth/upgrade` turns an individual workspace into a business.
- Frontend: hash routing in `App.jsx`, sidebar in `components/Sidebar.jsx`, logo in `components/Logo.jsx` (CSS variables `--logo-ink`, `--logo-sub`, `--logo-dot`).

## Rules
- Portability: avoid `$pull`, `$dateToString`, `$max` and grouped `$sum:1` in Mongo queries; aggregate in JS.
- Never store form answers in notification emails (counts and links only).
- No emojis or em dashes in UI text or docs.

## Deferred
Dynamic routing, submission status tracking, workflow automation. Real SMTP and real AI key paths are untested against live services (see SETUP.md go-live checklist).
