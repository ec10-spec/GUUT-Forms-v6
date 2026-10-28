# QA round (Oct 27 2026): what changed

Status per item from the QA handover. "Done" = built and checked (backend tests, a production build, and a scripted browser pass). "Owner" = a setting you change outside the code.

Backend tests: 161 passed, 0 failed (was 99). New checks are in `backend/tests/main.test.mjs` under the "QA round" suites. They were run against FerretDB because the MongoDB test binary could not be downloaded here; run `cd backend && npm test` once more locally or in CI before deploying.

## P0
| # | Item | Status | Where |
|---|---|---|---|
| 1 | File Upload stored only the file name | Done. Files upload to the form's own database (GridFS), checked against a per-question type allowlist (images, PDF, Word, spreadsheets, text), size limit up to 10 MB and the file's real contents. Responses table shows a thumbnail or link; CSV has a 7-day signed link; PDF lists the file name. The standalone HTML export uploads too. | `utils/uploads.js`, `routes/uploads.js`, `FormRenderer.jsx`, `FieldEditor.jsx` |
| 2 | AI chat history lost | Done. Each chat is saved server side (`AnalysisChat` in the tenant database: form, user, messages, token use). "New chat", a list of past chats, "Delete chat". The assistant also stays mounted across tab switches, and the answer length is remembered. | `routes/analysis.js`, `AiAnalyst.jsx` |
| 3 | Unsaved builder edits lost | Done. Leaving with unsaved changes asks first (in-app links and closing the tab). Drafts autosave 3 s after the last change with a "Saved" indicator. Published forms are not autosaved (edits would go live half-finished); they keep a local backup that is offered back after a reload. | `FormBuilder.jsx`, `lib/navGuard.js` |
| 4 | Submissions not validated | Done. One shared validator (`utils/answers.js`, copied to `frontend/src/lib/answers.js`, a test keeps them identical) used by live submissions, the importer and analytics: trimmed strings, email format, numbers, ratings 1 to 5 (whole numbers), options only, real dates, answers to hidden questions dropped, caps (text 500, long text 5,000). Errors return 400 with the question label and show under each question. | `utils/answers.js`, `routes/submissions.js` |
| 5 | Invalid data in analytics and AI | Done. Invalid stored values are counted as "Invalid", left out of averages and bars, and explained to the AI. | `utils/analytics.js` |

## P1
| # | Item | Status |
|---|---|---|
| 6 | Token balance shown without a key | Done. Budget returns `aiReady`; Home, Settings > Usage and the assistant show "Add your AI key" with a link to Settings > AI. "Through your own provider key" only shows when a key exists. Generate and Send are disabled until AI is ready. |
| 7 | AI privacy text wrong | Done. Word counts from free text are no longer sent unless answers are shared, and never for name or contact questions; the text now says exactly what is sent. |
| 8 | Conditional logic too limited | Done. Sources: single select, checkboxes, rating, number, date. Operators: is, is one of, at most, at least. Only earlier questions can be sources. AI generation sets conditions when the prompt implies them. |
| 9 | Conditional questions distort stats | Done. Answer rate counts only responses where the question was shown. |
| 10 | UTC and local dates mixed | Done. Charts, first/latest response and Usage group by the viewer's time zone. CSV has "Submitted (your zone)" and "Submitted (UTC)" columns. Imported date-only timestamps keep their calendar day. |
| 11 | Misleading time chart | Done. Bar chart on a zero-filled axis, by day, week or month depending on the span. |
| 12 | Import accepts bad rows | Done. Invalid cells are blanked with a note; rows missing a required answer are skipped and counted; unreadable timestamps are flagged. |
| 13 | Public forms in dark mode | Done. Public forms always render in the owner's light design; the button text colour is picked for contrast with the chosen colour. |
| 14 | Background only a band | Done. The owner's background covers the whole page. |
| 15 | Header images as base64 | Done. Uploaded to a file store and saved as a URL; resized to 1600 px wide and compressed to WebP or JPEG in the browser; 2 MB cap; recommended size shown. Saving a new base64 image is refused. Existing ones keep working; `npm run migrate:header-images` converts them. |
| 16 | Colours accept any text | Done. Hex only, on the page and the server. |
| 17 | Stale error messages | Done. Builder checks re-run on every change; server errors clear on the next edit. |
| 18 | Public API leaks fields | Done. Respondents no longer receive `generationPrompt`, `source`, `ownerId`, `sizeBytes` or `isPublic`. |
| 19 | No forgot password | Done. Sign-in page link, `/api/auth/forgot` and `/api/auth/reset`, single-use 1-hour link. The email goes out once SMTP is set. |
| 20 | Invalid join link shows the form | Done. Shows the problem with "Sign in" and "Create an individual account" instead. |
| 21 | Sessions survive a password change | Done. Tokens carry a version; changing or resetting a password (including by an admin) signs out every other device. |
| 22 | Sign-in polish | Done. Show/Hide password, "Welcome back" heading, logo on the card, email kept between tabs and on "Forgot password". |
| 23 | Bare "Form not found" | Done. Proper page with logo and a link; thank-you page keeps the form's branding. |

## P2 and P3
| # | Item | Status |
|---|---|---|
| 24 | Checkboxes above labels | Done |
| 25 | Invisible quick buttons and token text | Done |
| 26 | Unreadable home error | Done (light error box) |
| 27 | Generate with empty prompt | Done (disabled, with a hint; key requirement shown up front) |
| 28 | Editor not sticky | Done (sticky right column; new questions scroll into view) |
| 29 | Title clipped, description scrolls | Done (ellipsis, description grows) |
| 30 | Responses table | Done (2-line cells, click a row for full text, sentence-case headers, ", " joins, toolbar buttons stay together) |
| 31 | Free-text filter for choices | Done (dropdown of options, exact match) |
| 32 | Chart labels lose spaces | Done |
| 33 | Uneven analysis cards | Done |
| 34 | Name word lists, stop words, HTML | Done |
| 35 | Design panel | Done (spacing, small Remove button, "Replace image", styled file picker on forms) |
| 36 | Pricing note squashed | Done |
| 37 | Header shifts between tabs | Done (`scrollbar-gutter: stable`) |
| 38 | "Blank form" and "See all" | Done |
| 39 | Share menu too narrow | Done |
| 40 | Teams and Approvals headers | Done |
| 41 | Report button covers content | Done (icon only below 600 px, extra bottom space) |
| 42 | Quick switcher drops keys | Done |
| 43 | No publish confirmation, selection jumps | Done ("Published" bar with Copy link and Open; selection kept) |
| 44 | Bare thank-you page | Done (title, header image, colours, "Submit another response") |
| 45 | Accessibility | Done (named checkboxes, ratings as a radio group with arrow keys, move up/down buttons beside drag and drop, labelled file inputs, labels tied to inputs) |
| 46 | "User login tab" text | Done |
| 47 | Test needs a saved key | Done (tests the typed key before saving; key format checked) |
| 48 | Duplicate templates | Done (kept "Employee onboarding" and "Donation pledge") |
| 49 | Missing space | Done |
| 50 | "Choose Starter" for current plan | Done ("Current plan") |
| 51 | "Brief" only lowers the cap | Done (length instruction per setting in the system prompt) |
| 52 | Cost estimate too low | Done (per-model input and output prices; override with `AI_PRICES_JSON`) |
| 53 | Sharing with a non-member | Done ("Invite them to join your company" for admins, with the join link) |

## Database
| # | Item | Status |
|---|---|---|
| 54 | Platform data in `test` | Code done: `PLATFORM_DB_NAME` (default `guut_platform`), startup warning, migration script. **Owner:** run the migration and set the variable (SETUP.md, v12). Until then the app keeps using `test`, so nothing breaks on deploy. |
| 55 | No backups | Code done: `npm run backup` / `npm run restore` and a daily GitHub Actions workflow (`docs/backup-workflow.yml`). **Owner:** turn the workflow on and add the `MONGO_URI` secret. |
| 56 | Full admin user, open IP list | **Owner** (Atlas settings): app-only `readWrite` user in Render's `MONGO_URI`; keep `0.0.0.0/0` only while Render has no fixed IPs. Steps in SETUP.md. |
| 57 | Missing compound indexes | Done (`submissions {formId, createdAt}`, `tokenusages {userId, createdAt}`, plus one for saved chats). Created automatically on start. |
| 58 | Stale `measuredAt` | Done (updated on every storage change; Settings > Usage shows "Last updated"). |

## Left as placeholders (as agreed)
Free AI credit copy, plan prices and storage caps, "Online payment is not set up yet", Explore's "surveys", and email delivery (SMTP, verification, notification and reset emails, "Send test email").

## Test data
Delete "Contact form" and "Coffee Shop Customer Feedback Survey" from the live account when you're done.
