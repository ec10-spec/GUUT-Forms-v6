# GUUT Forms: how it works for individuals and businesses

## Individuals (free for now)

1. Create account: choose Individual, enter name, email, password. Email confirmation is off for now.
2. Sign in. You get a personal workspace stored in GUUT's hosted database, with a storage cap (`INDIVIDUAL_MAX_STORAGE_MB`, empty means unlimited).
3. Build: describe a form to the AI (your own key, or the free AI credit) or start from a template or blank form. Edit fields, set Design, publish.
4. Share the public link, share by email with any account as Viewer or Editor, or create a team (friends, class, club) and share with the team.
5. Responses: table, search, field filter, import older responses (CSV or Excel), CSV and PDF export, charts, and an AI assistant over that one form.
6. Only for businesses: linking your own database, "Run on your own server", company admin, approvals.

## Businesses (paid plans, billing set by hand until a payment processor is added)

1. A founder creates a Business account with a company name and plan and becomes company admin.
2. Invite people with the company join link (Admin, Invite people). They sign in or sign up, ask to join, and the admin approves them under Approvals.
3. Storage: hosted by default; the admin can link the company's own MongoDB (verified migration).
4. Roles: company admin manages every company form and user. Everyone else sees only their own forms and what is shared with them. Nobody can edit or republish a form they were not given edit access to; anyone with view access can copy it.
5. Sharing and teams: per form, add a colleague as Viewer or Editor, or share with a company team.
6. Public listing: a member's request to list a form in the public repository waits under Approvals; admins decide.
7. Notifications: per person, every response, every N hours, or every N responses; optionally also for forms shared with them. Counts and links only, never answers.
8. Usage: AI tokens per user, per company and platform-wide. Every person uses their own AI key.

## Platform team (superadmin)

Signs in on the same page. Sees all companies, sets plan and status, handles support, reads logs and platform-wide usage. Platform users are created by the first-run `SUPERADMIN_*` settings.

## What changed since v4 and v5

- v6: individuals can share forms with other individuals; email confirmation is required at sign-up (needs SMTP).
- v7: storage tracking per form, response and company; free storage cap for individuals; plan storage allowances for businesses; go-live checklist in SETUP.md.
- v8: Teams (business only, any member can create); fixed the confirmation link that opened the login page.
- v9: automated backend test suite with run history, and a CI workflow.
- v10: logo applied across the app and emails, sidebar navigation with Ctrl K quick switcher and breadcrumbs, redesigned sign-in, cards, tables and mobile menu, dark-mode logo, PDF export of responses, response field filter, design studio with live preview of the real form, "Made with GUUT Forms" footer on public forms.
- Still deferred: dynamic routing, submission status tracking and workflow automation.
- v11: public top bar and pricing, sharing and teams for individuals, free AI credit, company join link, Approvals tab, response import, email confirmation off by default.
