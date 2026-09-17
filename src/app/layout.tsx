import type { Metadata, Viewport } from "next";
import { Google_Sans_Flex } from "next/font/google";
import { Providers } from "@/app/providers";
import { APP_DESCRIPTION, APP_NAME, APP_TAGLINE } from "@/lib/brand";
import { getThemeForRequest } from "@/server/theme";
import { InlineScript } from "@/ui/components/inline-script";
import { themeCss } from "@/ui/theme/scheme";
import "./globals.css";

const googleSansFlex = Google_Sans_Flex({
  subsets: ["latin"],
  variable: "--font-google-sans-flex",
  axes: ["opsz", "ROND"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: `${APP_NAME} · ${APP_TAGLINE}`, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_NAME,
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Stores the browser's time zone so due dates follow the teacher's calendar.
const TIME_ZONE_SCRIPT = `try{document.cookie="tz="+encodeURIComponent(Intl.DateTimeFormat().resolvedOptions().timeZone)+";path=/;max-age=31536000;samesite=lax"}catch(e){}`;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await getThemeForRequest();
  return (
    <html lang="en" data-theme-mode={theme.mode} className={googleSansFlex.variable}>
      <head>
        <style id="md-theme" dangerouslySetInnerHTML={{ __html: themeCss(theme.seed, theme.contrast) }} />
        <InlineScript html={TIME_ZONE_SCRIPT} />
      </head>
      <body className="min-h-dvh bg-surface font-sans text-on-surface antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
