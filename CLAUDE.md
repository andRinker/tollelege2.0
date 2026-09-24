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

**Turn on auto-merge for every pull request you open here**, using the merge method (not squash), right after creating it. That's the owner's standing instruction, so don't wait to be asked. Branch protection still holds the merge until both checks pass, so auto-merge never skips CI. It does mean the PR goes to production without anyone reading it first, so before opening one, say anything in it that deserves a second look, such as a migration that rewrites existing rows. If a PR shouldn't land yet, open it as a draft, which auto-merge won't touch, and say why.

`scripts/vercel-ignore-build.mjs` can gate the deploy itself on CI, for when branch protection isn't available. It is written and tested but **not wired up** — it needs `GITHUB_CI_TOKEN` in Vercel and the Ignored Build Step command set.

## Rules

- **Tenant isolation.** Teacher data is always filtered by `teacher_id`, and the teacher ID comes only from `requireTeacher()` in `src/server/session.ts` — never from client input. Data-access functions live in `src/server/*` with the signature `(db, teacherId, input)`. The lending library is one place two teachers meet, and it goes through `shelf_loans`; co-teaching is the other, through `class_teachers` and `requireClassroom()` — see both below. The admin is the one role that reaches across, and only through `src/server/admin.ts` behind `requireAdmin()` — see below. Nothing else crosses.
- Tables holding teacher data need a `teacher_id` column, a unique `(id, teacher_id)` constraint, and composite foreign keys `(parent_id, teacher_id)` to their parents.
- `src/proxy.ts` only redirects optimistically on cookie presence. Every page, layout, and server action must call `requireTeacher()`.
- Schema files in `src/db/schema/` use relative imports, because drizzle-kit loads them without path aliases.
- **Don't reference columns inside a drizzle `sql` template.** It renders them unqualified, so `` sql`... where ${copies.bookId} = ${books.id}` `` becomes `where book_id = id` and silently compares a row against itself. Both copy counts in `catalog.ts` read zero for months this way, and one of them reached teachers as "You have 0 copies". Use `leftJoin` + `groupBy` and let the query builder qualify the names.
- Validate server action input with Zod before calling the data layer.
- UI is built from the M3E components in `src/ui/` and theme tokens such as `bg-surface-container` and `text-on-surface`. Don't hardcode colors.
- Student data stays minimal: names and an optional student ID only.
- **A checkout outlives the book.** A student's reading history belongs to the student, so deleting a book or copy they read must not erase it. Each `loans` row records `book_title` and `book_authors` when it's made, and `copy_id`/`book_id` go null on delete. Readers show the book's live title while it exists and the recorded one after, so `leftJoin` from `loans`, never `innerJoin`. Only a book still out with a student can't be deleted, and the `loans_open_has_copy` check enforces that in the database too. Those two foreign keys are `ON DELETE SET NULL (column)` in the migration, because a plain `SET NULL` would also null `teacher_id` and fail. drizzle can't write the column list, so carry it across by hand if the keys are ever regenerated.

## Book metadata

`src/server/isbn-lookup/` asks Open Library and Google Books **at once** and merges them, rather than stopping at the first answer — each is stronger in different fields, and taking one whole record gives a worse book than combining both. Google's records come from publisher feeds (properly cased titles, clean author lists); Open Library's come from library catalogues (publisher, page count, cover, blurb). `merge.ts` also un-inverts `Last, First` author names and de-duplicates them. Results are cached in `isbn_lookup_cache`, shared across teachers, for 90 days when found and a day when not.

A lookup only reports `unavailable` when *every* configured source failed; one source being down must never hide a book the other knows.

## Shelf photos

`src/server/shelf-scan/` reads a photo with Gemini, matches each spine against both catalogues, and returns proposals. It writes nothing.

**Everything it finds is confirmed by a teacher before it is added, and that is not negotiable.** On a real shelf of 30 books it matched 27 correctly, matched one to an entirely different book, and missed two. A wrong book added silently is worse than a book left out, because it surfaces months later when a student can't find it.

Consequences of that, all deliberate:

- Matching grades titles *and* authors. A title that matches while the author contradicts is demoted, not presented as a good match.
- **Searching is strict first, then looser, and grading never loosens.** A spine often prints author and illustrator ("Clements/Selznick"), and searched as one author that found nothing, so Frindle came back unmatched. `matchSpine` searches by title and `leadAuthor`; only if nothing grades does it try the title alone, then the author alone. The author-alone search is for a title read with a letter wrong ("Jumbles" for "Jumbies"): `nearlySameTitle` accepts it only with the author agreeing, and only as `weak`, so it starts unticked. The comparisons live in `titles.ts`, free of server imports.
- Doubtful rows, and books the teacher already owns, start unticked.
- Several candidate editions are kept per spine. A classic read correctly is routinely the wrong printing.
- A spine matching a book already on the shelves offers another **copy**, never a second title — see `owned.ts`.
- Photos are sent to Google and never stored. `/privacy` says so, and must keep saying so.

**It says what it couldn't finish, and where.** The reader lists every spine left to right, including the ones it can see but not read, so a scan comes back as `slots` in shelf order instead of a bag of matches. The two books in "missed two" above used to vanish without a trace; now they are rows.

- An unreadable spine carries a `fragment`: whatever *was* legible. It is a partial read, **never a guess**. An illegible spine gives a guess almost nothing to go on, and a plausible wrong title is the most expensive failure here, while a position plus one barcode scan is certain and takes seconds.
- `describeGap` in `src/lib/shelf-gaps.ts` places a gap by its nearest known neighbours ("2nd of 3, between X and Y"). A spine read but matched by no catalogue still anchors, because the teacher can see its title, and so does a gap already filled, so the list tightens as it is worked.
- Each gap offers Scan it, Type ISBN and By hand. **Scan it** arms the row: the next barcode from the phone or a USB scanner lands there through `addBookByScan` like any other. Dialogs normally swallow a wedge burst, so the armed review opts back in with `data-barcode-wedge`.
- **A count is a check, never a quota.** The teacher can say how many books are on the shelf (every spine, copies too). Folded duplicate spines keep a `copies` count, which the tally counts and confirming adds. Short of the count, the reader takes **one second look** with the first reading and the count in its prompt, whose rules still forbid guessing and say outright that coming up short is right. `mergeLooks` in `second-look.ts` takes the fuller reading, flags titles only the second look saw (`secondLook`, started unticked), and puts back anything the first read that the second dropped, so a second look can add to a shelf but never remove from it. Two readings rarely agree to the letter, so a book is recognised across them by `sameTitle`, not by exact title and author; exact keys put the first reading's spellings back beside the second's and turned a 48-book shelf into 51.
- **`tidyShelf` runs on every reading, and never adds a book.** Copies side by side are one row with their `copies` summed, however each printed its author. A spine it couldn't read whose legible letters fit the title beside it (`fragmentFits`: "THE WA SAVED" beside "The War That Saved My Life", a sticker over the rest) is offered as that book with `partial` set, started unticked and labelled with what was legible. That's a suggestion from the app, not a guess by the reader, so the reader's rule stands; and if the book beside it wasn't found, the row goes back to being a gap. Books the count says exist and no reading saw become "Not found in the photo" rows with the same three ways out.
- **One shelf per photo.** After a photo is picked, `ShelfCropper` lets the teacher box one shelf (optional; "Use the whole photo" skips it). `preparePhoto` cuts the crop from the full-size image *before* shrinking it, and caps the upload by **pixel count, not longest side**, so a long thin crop keeps its full width; capping by longest side made cropping a wide photo gain nothing. As a backstop the reader is told to read only the shelf the photo is centred on and to count, not list, spines from others (`otherShelfSpines`), which the review reports so a wrong pick is caught.
- **A failed reading says why.** `ShelfScanUnavailableError.reason` is one of timeout, busy, refused, unreadable, unconfigured; the teacher sees `describeShelfFailure(reason)` and the log keeps the HTTP status, Google's own error text, the finish reason and the timing. Busy (429/5xx) is retried once. A scan must finish inside its 180-second request, so readings share a 130-second budget (110 for any one) and the second look only starts with 45 seconds of it left. Those numbers are measured, not guessed: on a real 42-book shelf the default model took 15–45 s with its own thinking and was right on nearly every spine, while low thinking took 5 s and left a quarter of it muddled, so time is given rather than thinking taken away. On a 48-book shelf it took 10–70 s and twice in fifteen readings passed 75 s, which is why the cap is well above the usual time; the count in the prompt made no difference to it. `GEMINI_THINKING` can still override it. `GEMINI_MODEL` is normalised (`3.5 Flash Lite` → `gemini-3.5-flash-lite`), and a model Google doesn't know falls back to the default alias with a loud log line rather than failing every scan. Answers are joined across all their parts (newer models split them) and an answer cut short (`MAX_TOKENS`) or withheld (`SAFETY`) is an error, not an empty shelf. Every successful reading logs its size and time, which is what to tune the budget from.
- `SHELF_SCAN_FIXTURES=1` swaps the reader and the catalogue for the canned, deliberately awkward shelf in `fixtures.ts`, so the review can run without a Gemini key; with a count above six it answers the second look from `FIXTURE_SECOND_LOOK`. The e2e suite runs with it on. Its ISBNs must also be in `isbn-lookup/fixtures.ts`, because confirming the shelf adds each book through the ordinary lookup.

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

## Admin

`ADMIN_EMAILS` (comma-separated) names the administrators, and an address only counts when it is **verified**. Password sign-ups here are never verified, so without that check anyone could register an admin's address first and walk in as admin; Google sign-ins are verified by Google. `isAdmin` lives in `src/lib/admin-access.ts`, free of server imports, because the auth config needs it too.

`/admin` lists every account with counts, shows system health, and keeps the audit trail. `/admin/teachers/[id]` is a read-only look inside one account, plus Sign out everywhere and Delete. A non-admin gets a 404, not a 403, so the area doesn't announce itself.

**Editing someone's library is done by acting as them, never by admin-only write paths.** `src/lib/act-as.ts` is a two-endpoint Better Auth plugin: start swaps the admin's session for a fresh one in the teacher's account, marked `session.impersonated_by`, with the admin's own token kept in a signed `admin_session` cookie; stop puts it back. While it lasts, `requireTeacher()` returns the teacher, so every existing screen works for them and tenant isolation holds unchanged. Better Auth's own admin plugin does the same but brings a role column and a dozen more endpoints, which is why it isn't used.

Consequences, all deliberate:

- Every look inside an account, every start and stop of acting, every sign-out and every deletion goes in `admin_audit`. It has no foreign keys and copies emails in, so a record of deleting an account outlives the account. The edits made while acting are the teacher's, like any other edit.
- Acting lasts at most an hour, can't target another admin or yourself, and hides `/admin` while it lasts. Stopping revokes any phone paired during it, which would otherwise keep adding to their library until midnight.
- While acting, the layout doesn't save the browser's time zone into the teacher's settings: it's the admin's browser, not theirs. Sign out is replaced by "Back to your account", since signing out would end the teacher's own phone pairings.
- Deleting an account is refused while a book is lent to or from another teacher, and for the admin's own account. It needs the account's email typed to confirm.
- **An admin can create an account for a colleague who hasn't signed up**, build it by acting as them, and hand it over. It has no login of its own; their first Google sign-in with that email links to it rather than making a new account. Better Auth only links into an account whose email is **verified** (`requireLocalEmailVerified`), so `createColleagueAccount` creates it verified, with the admin vouching for the address. `tests/integration/colleague-account.test.ts` proves the handover through Better Auth's own linking routine and the app's real `accountOptions`, including the control case that an unverified account is refused. Password sign-up with that email says it's taken; "Forgot password" still works, since a reset creates the password.
- "Last active" counts only a teacher's own sessions, never ones an admin started by acting as them.
- `/privacy` says what an admin can see and do, and must keep matching.

## Co-teaching

An owner shares a class, one at a time, with a co-teacher, who then works in the owner's classroom: the owner's library, and only the shared classes' students and checkouts. `class_teachers` holds the grants (composite `(class_id, owner_teacher_id)` key into `classes`, so a grant naming the wrong owner is rejected by the database, and deleting a class ends its sharing). `src/server/coteaching.ts` owns the rules.

`requireClassroom()` returns a `Classroom`: `teacherId` is the **owner** (pass it to the data layer exactly as before), `actorId` is who's signed in, and `classIds` is the shared classes, or null for your own classroom. A `classroom` cookie says which one you're in; `resolveClassroom` checks it against the grants every request and falls back to your own, so a forged or stale cookie gets you nothing.

Consequences, all deliberate:

- **Access is default-closed.** Only pages and actions that call `requireClassroom()` work in a shared classroom; everything else still calls `requireTeacher()` and sees your own account. Settings, Lending and phone pairing stay that way. Converting a page means passing `classIds` to every read (`inScope`) and asserting scope (`assertClassInScope`, `assertStudentInScope`, `assertLoanInScope`, which throw `NotFoundError`) on every write that names a class, student or loan.
- **The owner's decisions stay the owner's**, enforced in the action with `assertOwner`, not only by hiding buttons: deleting books, copies or students, withdrawing a copy, lending settings, and creating, editing, archiving or deleting classes. Students with no class are the owner's alone.
- A copy out to a student in an unshared class shows as checked out with the borrower redacted (`borrowerHidden`), so it's never offered as available.
- A co-teacher is granted only on a **verified** email. An address with no account, or an unverified one, gets an invite in `class_teacher_invites`, claimed in the app layout on the first verified sign-in. Otherwise registering a colleague's address with a password would hand over their class.
- Checkouts aren't attributed to who made them; the classroom is the owner's.

### Handing over

`src/server/handover.ts` gives classes and books to another teacher: offered from Settings → Hand over, accepted from the recipient's Home page. The recipient needs a verified email, like a co-teacher: an offer to anyone else waits on `to_email` with `to_teacher_id` null, and `claimHandovers` in the app layout gives it to the first verified sign-in with that address. The student-ID clash check needs the recipient's roster, so for a waiting offer it only runs on accept. An offer (`handovers`) stores the class and book IDs resolved when it was sent, one pending per sender, and nothing moves until it's accepted. The one exception is **"My entire library"** (`everything`), which stores no IDs and is resolved again when counted and when accepted, because an offer waiting for a colleague to sign up can sit for months while the library grows.

Accepting is **one transaction that rewrites `teacher_id` on every row that moves**, with the ownership keys deferred to commit (`set constraints all deferred`). Migration 0007 made those keys `DEFERRABLE INITIALLY IMMEDIATE`, by hand, because drizzle can't declare it; they're still checked per statement everywhere else, and ON DELETE actions never defer. If the keys are ever regenerated, carry that across with the `SET NULL (column)` clauses.

Consequences, all deliberate:

- Every refusal is checked again on accepting, and a blocked offer stays pending. Refused: a book out with a student when the book and the student would end up in different classrooms; a book lent to, borrowed from, or requested by another teacher; a student ID the recipient already uses.
- A class takes its students, and a student takes their history. A **past** checkout that spans the split keeps the student and lets go of the book (`copy_id`/`book_id` null, recorded title kept), exactly as deleting the book would.
- A book the recipient already owns by ISBN joins their title as more copies, renumbered, and the sender's title row is deleted. Finished `shelf_loans` rows for moved books are deleted; nothing reads them.
- **Some of a title's copies can go on their own** (`handovers.copy_ids`, alongside whole titles in `book_ids`). The offer picks which, and prefers copies on the shelf and the highest-numbered, so the sender keeps copy 1. They join the recipient's title or start a new one with the same details, and the sender keeps the rest. Here the split is by copy: a past checkout goes with its student, and lets go of the copy if the copy doesn't go too. A student who stays keeps the book on their history, since the title is still the sender's. Every copy is the whole title, and so is a set that would leave the sender a title with no copies.
- Co-teacher grants and invites move with the class. The previous owner is added as a co-teacher of every class handed over, and the recipient's own grant on it is dropped.

## Lending library

`src/server/connections.ts` links two teachers; `src/server/lending.ts` moves a book between them. Teachers connect one pair at a time — an invitation by email, accepted by the other — and `teacher_connections` stores the pair normalised (`teacher_a_id < teacher_b_id`) so one pair can only ever have one row. Once connected, each sees the other's titles; `books.lendable` defaults to true and is the per-title exception, for class sets.

**The copy never changes owner.** Approving a request flips the owner's copy to `lent_out` — which drops it out of their own checkout queries, since those already filter on `in_circulation` — and creates a stand-in copy on the borrower's shelf. The borrower's students check that stand-in out through the ordinary flow, which is why none of `circulation.ts` needed changing.

Consequences, all deliberate:

- `shelf_loans` holds two teacher IDs (so does `class_teachers`), and it reaches each library through a composite `(id, teacher_id)` foreign key. A row pairing one teacher's copy with another's shelf is rejected by the database, not by a query someone has to remember to write.
- The stand-in folds into the borrower's existing title when they already own the ISBN, the same way a shelf photo offers a copy rather than a duplicate.
- Returning **withdraws** the stand-in rather than deleting it once a student has read it, so the borrower's checkout history outlives the loan. With no history it is deleted, along with the title if that was its only copy.
- A borrowed copy is never offered on to a third teacher, and `assertNotInShelfLoan` blocks deleting or restatusing anything currently away.
- Set `shelf_loans.borrower_copy_id` to null **before** deleting a stand-in copy: the foreign key cascades, and deleting the copy first takes the loan record with it.
- What a connected teacher can see is written down in `/privacy`, and must keep matching what `browseShelf` actually selects.
