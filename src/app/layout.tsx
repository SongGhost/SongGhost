import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Plus_Jakarta_Sans, Space_Mono } from "next/font/google";
import { AppleMusicProvider } from "@/context/AppleMusicContext";
import { MusicSourceProvider } from "@/context/MusicSourceContext";
import { TierProvider } from "@/context/TierContext";
import { UserPreferencesProvider } from "@/context/UserPreferencesContext";
import "./globals.css";

const fontSans = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
});

const fontMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "SongHost — Your Personal Music DJ",
  description: "The master of ceremonies for your personal music library.",
  manifest: "/manifest.json",
  openGraph: {
    title: "SongHost — Your Personal Music DJ",
    description: "The master of ceremonies for your personal music library.",
    siteName: "SongHost",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "SongHost — Your Personal Music DJ",
    description: "The master of ceremonies for your personal music library.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en" className="overscroll-y-none">
        <body
          className={`${fontSans.variable} ${fontMono.variable} font-sans bg-[#09090b] text-zinc-100 antialiased selection:bg-accent/25 selection:text-accent overscroll-y-none`}
        >
          {/*
            Main layout wrapper. Contained rather than locked: this div scrolls
            with the page content, so it only needs to stop that scroll from
            chaining past `body` — the `html`/`body` guard above is what
            actually keeps a swipe from reaching the browser's refresh gesture.
          */}
          <div className="overscroll-y-contain">
            <UserPreferencesProvider>
              <TierProvider>
                <AppleMusicProvider>
                  <MusicSourceProvider>{children}</MusicSourceProvider>
                </AppleMusicProvider>
              </TierProvider>
            </UserPreferencesProvider>
          </div>
        </body>
      </html>
    </ClerkProvider>
  );
}
