import type { Metadata } from "next";
import type { ReactNode } from "react";
import { APP_NAME } from "@/lib/brand";
import { BrandMark } from "@/ui/components/brand";
import { LinkButton } from "@/ui/components/button";
import { TextLink } from "@/ui/components/text-link";
import { iconArrowBack } from "@/ui/icons/generated";

export const metadata: Metadata = {
  title: "Privacy",
  description: `How ${APP_NAME} handles teacher and student information.`,
};

const LAST_UPDATED = "September 22, 2026";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-title-lg-em text-on-surface">{title}</h2>
      <div className="flex flex-col gap-3 text-body-lg text-on-surface-variant [&_li]:pl-1 [&_strong]:font-medium [&_strong]:text-on-surface [&_ul]:flex [&_ul]:list-disc [&_ul]:flex-col [&_ul]:gap-2 [&_ul]:pl-6">
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPage() {
  const supportEmail = process.env.SUPPORT_EMAIL;
  const usesGoogleBooks = Boolean(process.env.GOOGLE_BOOKS_API_KEY);
  const usesShelfPhotos = Boolean(process.env.GEMINI_API_KEY);

  return (
    <div className="min-h-dvh bg-surface">
      <header className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 text-primary medium:px-6">
        <BrandMark />
        <LinkButton href="/sign-in" variant="text" size="sm" icon={iconArrowBack}>
          Back to {APP_NAME}
        </LinkButton>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-4 pt-6 pb-16 medium:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-display-sm-em text-on-surface">Privacy</h1>
          <p className="text-body-lg text-on-surface-variant">Last updated {LAST_UPDATED}</p>
        </div>

        <p className="text-body-lg text-on-surface">
          {APP_NAME} helps teachers catalog a classroom library and keep track of which students have which books. It&rsquo;s
          built to collect as little as possible, especially about students.
        </p>

        <Section title="Students">
          <p>Students don&rsquo;t have accounts and never use {APP_NAME} directly. For each student, a teacher can record only:</p>
          <ul>
            <li>First and last name</li>
            <li>An optional student ID number</li>
            <li>Which class they&rsquo;re in, and which books they&rsquo;ve borrowed and returned</li>
          </ul>
          <p>We don&rsquo;t collect student email addresses, photos, birthdates, grades, or any other information about students.</p>
        </Section>

        <Section title="Teachers">
          <p>When you create an account, we store:</p>
          <ul>
            <li>Your name and email address</li>
            <li>Your password, stored only as a secure one-way hash, if you sign in with email</li>
            <li>Your name, email address, and profile picture from Google, if you sign in with Google</li>
            <li>The IP address and browser type for each signed-in session, to keep your account secure</li>
          </ul>
          <p>
            We also store what you put into {APP_NAME}: your classes and rosters, your book catalog, checkout records, and
            settings such as loan periods, your time zone, and your color theme.
          </p>
          <p>
            If you pair a phone as a scanner, we store a one-way hash of that pairing code and a coarse description of the
            device, such as &ldquo;iPhone&rdquo;. A paired phone can add books to your library and send a shelf photo, and
            nothing else &mdash; it can&rsquo;t read your library, your classes, or your students. It stops working at
            midnight, and you can disconnect it at any time.
          </p>
        </Section>

        <Section title="Who can see your data">
          <p>
            Your classes, your students, and your checkout history are private to your account. No other teacher can see
            them, whatever else you share.
          </p>
          <p>
            Your book catalog is private too, until you connect with another teacher. Connecting takes an invitation from
            one of you and acceptance by the other, and either of you can undo it at any time. While you are connected,
            that teacher can see the titles you offer for lending &mdash; the title, authors, cover, reading level, tags,
            and how many copies are free &mdash; along with your name and email address. They never see your private notes
            on a book, where you shelve it, or who has borrowed it.
          </p>
          <p>
            Every title is offered by default so that a connected teacher&rsquo;s shelves aren&rsquo;t empty. You can hold
            any title back from the book&rsquo;s own page, and a book you have borrowed is never offered on to a third
            teacher.
          </p>
          <p>We don&rsquo;t sell your data, share it with advertisers, or use it for advertising. {APP_NAME} has no ads and no third-party analytics.</p>
        </Section>

        <Section title="Services we rely on">
          <ul>
            <li>
              <strong>Vercel</strong> hosts the app, and <strong>Neon</strong> hosts the database.
            </li>
            <li>
              <strong>Resend</strong> delivers password reset emails, so it receives your email address when you request one.
            </li>
            <li>
              <strong>Google</strong> handles sign-in if you choose &ldquo;Continue with Google.&rdquo;
            </li>
            <li>
              <strong>Open Library</strong> provides book details. When you look up a book, only its ISBN is sent. Book covers load
              from Open Library, so, as with any website, it can see your IP address when your browser loads a cover.
            </li>
            {usesGoogleBooks && (
              <li>
                <strong>Google Books</strong> is asked alongside Open Library, so each book uses the better details of the two. It
                also receives only the ISBN.
              </li>
            )}
            {usesShelfPhotos && (
              <li>
                <strong>Google Gemini</strong> reads shelf photos, if you use &ldquo;Photograph a shelf.&rdquo; See below.
              </li>
            )}
          </ul>
        </Section>

        {usesShelfPhotos && (
          <Section title="Shelf photos">
            <p>
              &ldquo;Photograph a shelf&rdquo; sends the photo you take to Google&rsquo;s Gemini service, which reads the book
              titles off the spines and sends them back. Nothing is added to your library until you confirm it.
            </p>
            <p>
              The photo is used for that one reading and then discarded. {APP_NAME} never saves it &mdash; not in the database,
              not on disk &mdash; and never sends anything else with it. What Google does with it is covered by their own
              privacy terms.
            </p>
            <p>
              Point the camera at books, not at people. A photo of a shelf carries no student information; a photo of a classroom
              might. If you would rather not send photos anywhere, don&rsquo;t use this feature &mdash; scanning barcodes and
              typing ISBNs work exactly as before.
            </p>
          </Section>
        )}

        <Section title="Cookies">
          <p>
            {APP_NAME} uses a sign-in cookie to keep you signed in, and two preference cookies: your time zone, so due dates are
            right, and whether the navigation menu is expanded. There are no tracking or advertising cookies.
          </p>
        </Section>

        <Section title="Keeping and deleting data">
          <p>
            Your data stays until you delete it. Deleting a book, a class, or a student removes it, and deleting a student also
            removes their borrowing history.
          </p>
          <p>
            To delete your whole account and everything in it, or to ask a question about your data,{" "}
            {supportEmail ? (
              <>
                email <TextLink href={`mailto:${supportEmail}`}>{supportEmail}</TextLink>.
              </>
            ) : (
              "contact the person who set up your school's account."
            )}
          </p>
        </Section>

        <Section title="Changes">
          <p>If we change how we handle data, we&rsquo;ll update this page and the date at the top.</p>
        </Section>
      </main>
    </div>
  );
}
