@AGENTS.md

# Tolle Lege

"Tolle lege" (take and read). Multi-teacher web app for cataloging a classroom library, managing class rosters, and checking books out to students. Next.js 16 (App Router, Server Actions) + React 19, Drizzle ORM on Postgres (PGlite locally, Neon on Vercel), Better Auth (email/password + Google), and a custom Material 3 Expressive design system built on React Aria Components.

Books get into the catalog four ways: a camera or USB barcode scan, a typed ISBN, a photo of a whole shelf, or by hand.

## Commands

- `npm run dev` — http://localhost:3000. Local data lives in `.data/pglite` and is migrated automatically on startup.
- `npm run dev:phone` — serves over HTTPS on the machine's LAN address, for testing the camera on a phone. Camera APIs need a secure context, so a phone loading a plain `http://` LAN address can't open the camera at all; the failure looks like a permissions problem but isn't one.
- `npm run typecheck` · `npm run lint` · `npm test` (Vitest unit + integration on in-memory PGlite) · `npm run test:e2e` (Playwright)
- `npm run db:generate -- --name <change>` — write a SQL migration after editing `src/db/schema/*`
- `npm run db:migrate` — apply migrations to PGlite, or to `DATABASE_URL` when set. PGlite is single-process: stop the dev server first.
- `npm run db:seed` · `npm run db:reset` — demo data (sign in as demo@tollelege.test / take-and-read; stop the dev server first) · delete and recreate the local database

## Environment

`.env.example` documents every variable. Only `BETTER_AUTH_SECRET` is required locally. Each optional key turns a feature on, and the app degrades cleanly without it rather than erroring:

- `GOOGLE_BOOKS_API_KEY` — adds Google Books as a second metadata source. Without it, only Open Library is asked.
- `GEMINI_API_KEY` — enables "Photograph a shelf". Without it the feature reports itself unavailable.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — Google sign-in. `RESEND_API_KEY` — password-reset email.

A misspelled variable name looks exactly like an unset one, so check the spelling before assuming a key is wrong.

Every value is also set in the Vercel project, so a fresh checkout doesn't need them hunted down again:

```
npx vercel link && npx vercel env pull .env.local
```

**Then check two of them before running the app.** `DATABASE_URL` points at the production Neon database, and the app uses Postgres whenever it is set — leaving it in means `npm run dev`, `db:migrate` and `db:seed` all operate on live teacher data. Blank it, and the app falls back to local PGlite. `BETTER_AUTH_URL` must be `http://localhost:3000` locally, not the production domain, or sign-in redirects leave the machine.

## Shipping

`main` is protected: both CI checks (`Types, lint, tests` and `End-to-end`) must pass before anything lands, and the rule applies to admins. Work goes through a pull request; a direct push to `main` is rejected. Merging deploys to production, and `vercel-build` runs `db:migrate` against Neon before building.

`scripts/vercel-ignore-build.mjs` can gate the deploy itself on CI, for when branch protection isn't available. It is written and tested but **not wired up** — it needs `GITHUB_CI_TOKEN` in Vercel and the Ignored Build Step command set.

## Rules

- **Tenant isolation.** Teacher data is always filtered by `teacher_id`, and the teacher ID comes only from `requireTeacher()` in `src/server/session.ts` — never from client input. Data-access functions live in `src/server/*` with the signature `(db, teacherId, input)`. The lending library is the one place two teachers meet, and it goes through `shelf_loans` — see below. Nothing else crosses.
- Tables holding teacher data need a `teacher_id` column, a unique `(id, teacher_id)` constraint, and composite foreign keys `(parent_id, teacher_id)` to their parents.
- `src/proxy.ts` only redirects optimistically on cookie presence. Every page, layout, and server action must call `requireTeacher()`.
- Schema files in `src/db/schema/` use relative imports, because drizzle-kit loads them without path aliases.
- **Don't reference columns inside a drizzle `sql` template.** It renders them unqualified, so `` sql`... where ${copies.bookId} = ${books.id}` `` becomes `where book_id = id` and silently compares a row against itself. Both copy counts in `catalog.ts` read zero for months this way, and one of them reached teachers as "You have 0 copies". Use `leftJoin` + `groupBy` and let the query builder qualify the names.
- Validate server action input with Zod before calling the data layer.
- UI is built from the M3E components in `src/ui/` and theme tokens such as `bg-surface-container` and `text-on-surface`. Don't hardcode colors.
- Student data stays minimal: names and an optional student ID only.

## Book metadata

`src/server/isbn-lookup/` asks Open Library and Google Books **at once** and merges them, rather than stopping at the first answer — each is stronger in different fields, and taking one whole record gives a worse book than combining both. Google's records come from publisher feeds (properly cased titles, clean author lists); Open Library's come from library catalogues (publisher, page count, cover, blurb). `merge.ts` also un-inverts `Last, First` author names and de-duplicates them. Results are cached in `isbn_lookup_cache`, shared across teachers, for 90 days when found and a day when not.

A lookup only reports `unavailable` when *every* configured source failed; one source being down must never hide a book the other knows.

## Shelf photos

`src/server/shelf-scan/` reads a photo with Gemini, matches each spine against both catalogues, and returns proposals. It writes nothing.

**Everything it finds is confirmed by a teacher before it is added, and that is not negotiable.** On a real shelf of 30 books it matched 27 correctly, matched one to an entirely different book, and missed two. A wrong book added silently is worse than a book left out, because it surfaces months later when a student can't find it.

Consequences of that, all deliberate:

- Matching grades titles *and* authors. A title that matches while the author contradicts is demoted, not presented as a good match.
- Doubtful rows, and books the teacher already owns, start unticked.
- Several candidate editions are kept per spine. A classic read correctly is routinely the wrong printing.
- A spine matching a book already on the shelves offers another **copy**, never a second title — see `owned.ts`.
- Photos are sent to Google and never stored. `/privacy` says so, and must keep saying so.

## Borrowing a phone as a scanner

A teacher whose school account won't sign in on their phone — a managed device that turns a work Google account into an enrolment prompt — still needs the camera in their pocket. `/library/add` shows a QR code; the phone opens `/scan` and becomes a barcode scanner without ever signing in.

The QR carries a **capability, not a session**. `src/server/scan-pairing.ts` owns it, and everything the phone can do is three route handlers under `src/app/api/scan/`: add a book by ISBN, send a shelf photo, claim the pairing. There is no fourth. It cannot read the library, the roster, or anything else, and `/api/scan/feed` — the only read — is authenticated by the teacher's own cookie, so a phone writes to the feed and can never read it.

Consequences, all deliberate:

- The token is 32 random bytes, stored **only as a SHA-256 hash**, and travels in the URL's **fragment**, which browsers never send to a server. It stays out of access logs, referrers and history sync, and `/scan` wipes it from the address bar as soon as it has read it.
- **The first phone to open a code keeps it.** Later devices are refused. A code photographed off a teacher's screen is useless once their own phone has claimed it — and if it is grabbed first, their phone is refused and they find out, which is the failure worth having.
- A pairing dies at **local midnight in the teacher's time zone**, capped at a day, and signing out revokes every one.
- The phone's request is what performs the add, so the laptop can sleep through half a shelf and lose nothing; it reads the backlog from `scan_events` when it wakes, from a cursor the page rendered with.
- Rate limits are counted from `scan_events` rather than memory, because serverless instances don't share memory. Shelf photos have their own much tighter allowance, since each one is a Gemini call.
- A shelf photo from the phone still **proposes**; the teacher confirms it in the browser exactly as always. A device with no account does not get to add books it merely thinks it recognised.
- `addBookByScan` in `src/server/quick-add.ts` is the one path a scanned barcode takes, whether it came from the USB wedge, the laptop camera or a phone. Scanning the same shelf two ways must give the same library.
- Anything shown about when a pairing expires is formatted **on the server** in the teacher's time zone. Formatting a time in the browser renders one thing on the server and another after hydration.

## Lending library

`src/server/connections.ts` links two teachers; `src/server/lending.ts` moves a book between them. Teachers connect one pair at a time — an invitation by email, accepted by the other — and `teacher_connections` stores the pair normalised (`teacher_a_id < teacher_b_id`) so one pair can only ever have one row. Once connected, each sees the other's titles; `books.lendable` defaults to true and is the per-title exception, for class sets.

**The copy never changes owner.** Approving a request flips the owner's copy to `lent_out` — which drops it out of their own checkout queries, since those already filter on `in_circulation` — and creates a stand-in copy on the borrower's shelf. The borrower's students check that stand-in out through the ordinary flow, which is why none of `circulation.ts` needed changing.

Consequences, all deliberate:

- `shelf_loans` is the only table holding two teacher IDs, and it reaches each library through a composite `(id, teacher_id)` foreign key. A row pairing one teacher's copy with another's shelf is rejected by the database, not by a query someone has to remember to write.
- The stand-in folds into the borrower's existing title when they already own the ISBN, the same way a shelf photo offers a copy rather than a duplicate.
- Returning **withdraws** the stand-in rather than deleting it once a student has read it, so the borrower's checkout history outlives the loan. With no history it is deleted, along with the title if that was its only copy.
- A borrowed copy is never offered on to a third teacher, and `assertNotInShelfLoan` blocks deleting or restatusing anything currently away.
- Set `shelf_loans.borrower_copy_id` to null **before** deleting a stand-in copy: the foreign key cascades, and deleting the copy first takes the loan record with it.
- What a connected teacher can see is written down in `/privacy`, and must keep matching what `browseShelf` actually selects.
