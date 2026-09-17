@AGENTS.md

# Classroom Library

Multi-teacher web app for cataloging a classroom library, managing class rosters, and checking books out to students. Next.js 16 (App Router, Server Actions) + React 19, Drizzle ORM on Postgres (PGlite locally, Neon on Vercel), Better Auth (email/password + Google), and a custom Material 3 Expressive design system built on React Aria Components.

## Commands

- `npm run dev` — http://localhost:3000. Local data lives in `.data/pglite` and is migrated automatically on startup.
- `npm run typecheck` · `npm run lint` · `npm test` (Vitest unit + integration on in-memory PGlite) · `npm run test:e2e` (Playwright)
- `npm run db:generate -- --name <change>` — write a SQL migration after editing `src/db/schema/*`
- `npm run db:migrate` — apply migrations to PGlite, or to `DATABASE_URL` when set. PGlite is single-process: stop the dev server first.
- `npm run db:seed` · `npm run db:reset` — demo data · delete and recreate the local database

## Rules

- **Tenant isolation.** Teacher data is always filtered by `teacher_id`, and the teacher ID comes only from `requireTeacher()` in `src/server/session.ts` — never from client input. Data-access functions live in `src/server/*` with the signature `(db, teacherId, input)`.
- Tables holding teacher data need a `teacher_id` column, a unique `(id, teacher_id)` constraint, and composite foreign keys `(parent_id, teacher_id)` to their parents.
- `src/proxy.ts` only redirects optimistically on cookie presence. Every page, layout, and server action must call `requireTeacher()`.
- Schema files in `src/db/schema/` use relative imports, because drizzle-kit loads them without path aliases.
- Validate server action input with Zod before calling the data layer.
- UI is built from the M3E components in `src/ui/` and theme tokens such as `bg-surface-container` and `text-on-surface`. Don't hardcode colors.
- Student data stays minimal: names and an optional student ID only.
