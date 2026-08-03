import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Plus_Jakarta_Sans, Space_Mono } from "next/font/google";
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
  title: "SongGhost — Shangri-La Studio Radio",
  description: "A sunlit studio-style music player with AI DJ intros",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body
          className={`${fontSans.variable} ${fontMono.variable} font-sans bg-zinc-950 text-zinc-100 antialiased selection:bg-amber-500/25 selection:text-amber-100`}
        >
          <UserPreferencesProvider>{children}</UserPreferencesProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
