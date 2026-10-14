# Setup

See `backend/.env.example` for every setting and `render.yaml` for the free Render deploy.
Local: `bash run.sh` (a dev platform-team login is printed on first start).


---

## v4 changes: accounts, sharing, notifications, analytics, AI chat

**Accounts.** See the v5 section below: anyone can sign up, and everyone uses one login page.

**Per-form sharing.** Owner or company admin: open a form, Share > Share with people. Access is by email and only for
people on the same team. Roles: Viewer (open form read-only, see responses and charts) and Editor (edit and publish).
Only the owner or a company admin can delete a form, change who has access, or list it publicly. Teammates can ask for
access from Home (Team forms), and the owner or any company admin approves.

**Email notifications (optional).** Set `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` and
`APP_URL` on the backend (any SMTP provider works). With `SMTP_HOST` empty, emails are simply off. Each person chooses in
Settings > Notifications: every response, one summary every N hours, or one email every N responses. Company admins are
also told when a form is created. Emails carry counts and a link only, never response content. The hours-based digest
uses an in-process timer, so the backend must stay running (not sleeping).

**Charts and AI assistant.** Form > Responses has three views: the table, Charts and analysis, and the AI assistant. The
assistant uses the signed-in user's own API key, sees aggregates only by default, and can optionally also see a sample of
recent answers (emails and files are never sent). Reply length is user-adjustable up to `MAX_TOKENS_PER_ANALYSIS`.
`DAILY_TOKEN_LIMIT` now defaults to 100000 because each chat message resends the data summary.

**Token tracking.** Users see their own usage under Settings > Usage, company admins see their team under Admin > AI
usage, and the platform team sees every user and company under Admin > AI usage.


---

## v5 changes: account types, single login, hosted storage, pricing

**One login page for everyone.** Platform team, company admins and members all sign in on the same form. What each
person sees is decided by their role on the server (the old "User login / Admin login" tabs are gone). The platform team
still signs in with `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`.

**Anyone can create an account (Create account tab):**
- **Individual**: a personal workspace hosted by us. Free and unlimited for now. To start charging later, set
  `INDIVIDUAL_MAX_FORMS` and/or `INDIVIDUAL_MAX_RESPONSES_PER_MONTH` (empty = unlimited).
- **Business**: creates a company and makes the signer its admin, on the chosen plan (starts as "trial").
- **Join my company**: an employee enters their company's code (Admin > Team shows it, with a copy button, a switch to stop
  accepting requests, and "New code"). They wait on an approval screen until a company admin approves or declines.
  Declined or waiting people can switch to a personal individual account. There is deliberately no company search,
  so nobody can browse which companies use the platform.

**Storage.** Individuals, and businesses that haven't connected their own database, are stored in a separate hosted
database on your cluster (`HOSTED_DB_NAME`, default `guut_hosted`; or point `HOSTED_DB_URI` at its own cluster).
Accounts stay in the platform database (`MONGO_URI`). A business can connect its own MongoDB under Settings > Database; with
"move my existing forms" ticked, its data is copied over and removed from hosted storage once the copy is verified.

**Pricing and billing.** Tiers live in `backend/utils/plans.js` and are shown on the login page. The business prices and
seat limits there are PLACEHOLDERS: edit them. There is no payment processor yet: a business sees its plan and can request
a change, and the platform team sets plan and status (trial / active / overdue / canceled) per company in Admin > Companies.
Set `ENFORCE_BILLING=true` to block inactive businesses from creating forms and to enforce each plan's seat limit; it is
off by default.

Other new settings: `SIGNUPS_ENABLED` (set to `false` to close sign-ups), `SIGNUP_RATE_LIMIT` (per IP per hour, default 30).


---

## v6 changes: individual sharing, required email confirmation

**Individuals can share forms.** An individual opens Share > Share with people and types the email of another
individual account (they need a free account first). Roles are the same (Viewer, Editor). Business members and the platform
team cannot be added this way, and business forms still only share inside the company. The person removes themselves or
the owner removes them at any time.

**Email confirmation is required at sign-up.** After creating an account, people get a link by email (valid 24 hours,
single use) and can't sign in until they open it; the link signs them in. Employees joining a company: the company admin is
emailed about the request only after the employee confirms their address. An unconfirmed sign-up never reserves an email
(the real owner can sign up again), and unconfirmed accounts are deleted after 7 days. This requires working SMTP
(`SMTP_*`, `APP_URL`): with confirmation required and no SMTP, sign-up is refused. For local development without email,
set `REQUIRE_EMAIL_VERIFICATION=false`. Accounts created by an admin, and accounts that existed before this version, count as
confirmed.


---

## v7 changes: storage tracking and the free storage cap

Every form and response records its approximate stored size, and each company keeps a running total. The total is updated
on every write and can be re-measured from scratch (Admin > Companies > "Recalculate storage" for the platform team,
`POST /api/company/storage/recalculate` for a company admin). Older data without recorded sizes is measured automatically
the first time storage is looked at.

- **Individuals:** set `INDIVIDUAL_MAX_STORAGE_MB` (empty = unlimited, the default). Once full, saving a form that grows
  storage and creating forms are refused with "Storage is full"; respondents see a neutral "can't accept responses right
  now" message and never the owner's billing details. Shrinking (deleting, removing an image) is always allowed. The
  pricing card on the login page follows this setting.
- **Businesses:** each plan has a storage allowance in `backend/utils/plans.js` (placeholders), enforced only when
  `ENFORCE_BILLING=true`. A business that linked its OWN database is never capped (it is their storage), but usage is still shown.
- **Who sees what:** Settings > Usage shows storage for individuals and company admins (whole workspace) and for members
  (only the forms they own), with the largest forms. Admin > Billing shows it against the plan. The platform console shows each
  company's storage against its limit, which is the raw data for pricing benchmarks.
- The big storage consumer is a form's header image (stored inside the form). Responses are capped at 10,000 characters per answer.

## Go-live test checklist (email and AI have only been tested against stand-ins)

1. Set `SMTP_*` and `APP_URL`. Create a test individual account with a real inbox: the confirmation email should arrive
   (check spam; set up SPF/DKIM for your sending domain), and the link should open the app signed in.
2. Settings > Notifications > "Send test email".
3. Publish a form, answer it in a private window, and confirm the notification arrives for each mode (every response,
   every N responses; for "every N hours" use a small number first).
4. Settings > AI: paste a real Claude or OpenAI key and run the connection test. On a form with about 10 responses, open
   Responses > AI assistant, run the quick analyses, then try the "share a sample of answers" option.
5. Settings > Usage: confirm tokens and storage move after the steps above.


---

## v8 changes: Teams, and a fix to the email-confirmation link

**Teams (business accounts).** A team is a named group inside one company (for example Marketing). Any member of the business can
create a team (Teams in the top bar) and add anyone from their own company by email. The creator and company admins manage
a team (add and remove people, rename, delete); everyone in the company can see which teams exist and who is in them; any member can
leave. To share a form with a team, open the form's Share menu > Share with people > Share with a team and choose Viewer or Editor. Access
follows the team: people added later get it straight away, people removed lose it straight away. If someone has access both personally and
through a team, the higher role wins. Only the owner or a company admin can share a form with a team, and deleting a form or changing
who has access stays with them. Deleting a team ends the access it gave. Moving a person to another company removes them from the old
company's teams. Teams don't exist for individual accounts.

**Fix: confirmation link.** In v6/v7 the link in the confirmation email opened the sign-in page instead of confirming the address, because the
app treated that page as login-only. It now works for someone who isn't signed in yet.


## v9 changes: automated tests with tracking

- `backend/tests/main.test.mjs`: 63 checks covering auth, company isolation, join approval, forms and responses, sharing roles, individual sharing, teams, the storage cap, usage endpoints, email confirmation (against a built-in SMTP capture) and platform admin. It boots the real server.
- Run it before each deploy: `cd backend && npm install && npm test`. Without `TEST_MONGO_URI` it downloads a throwaway MongoDB; with it (for example `mongodb://127.0.0.1:27017`) it uses that server and creates its own uniquely named databases.
- Tracking: every run appends to `backend/tests/results.json` (time, passed, failed, failing check names, commit). `npm run test:report` prints the history as a table.
- CI: `.github/workflows/test.yml` runs the suite and a frontend build on every push and pull request, and uploads the results file. To block bad deploys, keep Render's auto-deploy on "After CI checks pass" (Render service Settings, Build and Deploy).
- Not covered yet: real SMTP delivery and real AI keys (see the go-live checklist above).


## v10 changes: logo, navigation, design, exports

- Logo: the supplied artwork is in `frontend/public` (SVG lockups, favicon, PNGs) and as the `Logo` component. It is used in the sidebar, sign-in, verification and pending pages, About, public form footer, favicon and every email.
- Navigation: sidebar with New form, Forms, Teams, Explore, Admin, Settings, About; breadcrumbs inside a form; Ctrl or Cmd + K quick switcher for pages and forms; slide-over menu on phones.
- Responses: field filter (pick a field, type text), CSV and PDF export. PDF uses the `pdfkit` dependency (installed by `npm run build`).
- Design tab: controls beside a live preview of the actual form.
- Dark mode uses a light logo automatically.

## v11 changes: public site, sharing for everyone, join link, approvals, import, free AI credit

- **Signed-out layout.** A top bar (logo, About, Pricing, Explore, Sign in) replaces the sidebar. There is a Pricing page; prices are placeholders in `backend/utils/plans.js`.
- **Email confirmation is off by default.** The code is kept. Turn it on with `REQUIRE_EMAIL_VERIFICATION=true` once SMTP is tested. In Render, set it to `false` now (render.yaml already does for new deploys; an existing service keeps its old value until you change it).
- **Sharing and teams for everyone.** Any account can share a form with any other account by email. Individuals can create open teams (friends, a class, a club) and add anyone who has an account. Team members get an email when added. A person can opt in to emails about new responses on forms shared with them (Settings, Notifications).
- **Everything except database hosting is available to everyone.** Linking your own database and "Run on your own server" are for business accounts and the platform team only.
- **Company join link.** A company admin copies the link under Admin (Invite people). People sign in or sign up through it and ask to join; an admin approves under Approvals. Someone whose personal account already has forms is asked to use another email.
- **Approvals tab** (company admins). People asking to join, and forms waiting to be listed in the public repository. In a business, a member's "List in public repository" waits for admin approval; an admin's own listing is approved immediately.
- **Import older responses.** Responses tab, Import. Upload CSV or Excel, check the column matching, run Check rows, then Import. Values are converted to each field's type; the original date column can be kept. Imported rows are marked.
- **AI.** Each person uses their own key; nothing is shared across an organisation. Without a key, an account can use free AI credit: set `PLATFORM_AI_KEY` (and optionally `PLATFORM_AI_PROVIDER`, `FREE_AI_CREDIT_USD` default 5, `COST_PER_1K_TOKENS_USD` default 0.006 for the estimate). With no `PLATFORM_AI_KEY` there is no credit. The AI assistant tab has an Answer length control (Brief, Standard, Detailed) instead of a token slider. Form generation retries once with more room if the model was cut off.
- **Templates and first-run guide.** Home has an All templates gallery (13 starters in five categories, defined in `frontend/src/lib/templates.js`), and people with no forms see a three-step guide.
- **Branding.** Public forms from business accounts do not show the "Made with GUUT Forms" footer; free accounts do.
- **Free AI credit is marketing only for now.** Pricing says "coming soon". Leave `PLATFORM_AI_KEY` unset and no credit is given; the mechanism is built and switches on when you set it.
- **Access reminder.** Nobody in a company can open, edit or republish a form unless it is theirs or shared with them. Anyone who can view a form can copy it into their own workspace; copying never changes the original.

---

## Replacing your existing Git repo with this version

1. Make sure everything in the old repo is pushed (or clone it somewhere as a backup).
2. Unzip GUUT-Forms-v11.zip somewhere else. It contains one folder, `GUUT-Forms-2-main`.
3. In a terminal, in your existing repo folder, create a branch: `git checkout -b v11`.
4. Remove the old files but keep history: `git rm -r -q .` then `git clean -fdx -e .git` (this deletes untracked files, including a local `.env`, so copy it out first if you have one).
5. Copy everything from the unzipped `GUUT-Forms-2-main` folder into the repo root, including hidden files (`.gitignore`, `.github`). In Finder or Explorer, enable hidden files. Or on Mac and Linux: `cp -a /path/to/GUUT-Forms-2-main/. .`
6. Check the result: `git status` should show changes, no `node_modules`, no `.env`.
7. Commit and push: `git add -A && git commit -m "v11: public site, sharing, approvals, import" && git push -u origin v11`.
8. Open a pull request on GitHub, wait for the "tests" check to pass, then merge into your main branch.
9. Render redeploys automatically from the main branch. Before the first deploy of v11, confirm these environment variables in Render: `MONGO_URI`, `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `APP_URL` (your Render URL). `JWT_SECRET` and `ENCRYPTION_KEY` must stay the same as today, otherwise saved AI keys and company database links stop decrypting.
10. After deploy: open `/api/health`, sign in as the superadmin, create a test individual account and confirm the email arrives with the logo.

### Updating the repo you already pushed (GUUT-Forms-v4 on GitHub)

1. Unzip GUUT-Forms-v11.zip somewhere outside your repo folder.
2. In your repo folder: `git rm -r -q .` then `git clean -fdx -e .git`, then copy the unzipped contents in: `cp -a /path/to/GUUT-Forms-2-main/. .`
3. `git add -A && git commit -m "v11" && git push` (to `main`). The test workflow is saved as `docs/ci-test-workflow.yml`; to activate it later, move it to `.github/workflows/test.yml` and push with a token that has the `workflow` scope.
4. In Render, Environment: set `REQUIRE_EMAIL_VERIFICATION` to `false`, optionally add `PLATFORM_AI_KEY`. Render redeploys on push.
