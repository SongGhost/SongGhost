import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Share_Tech_Mono } from "next/font/google";
import HeaderNav from "@/components/HeaderNav";
import { UserPreferencesProvider } from "@/context/UserPreferencesContext";
import "./globals.css";

const displayFont = Share_Tech_Mono({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "SongGhost — Retro FM Radio",
  description: "A vintage analog radio-style music player with AI DJ intros",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={`${displayFont.variable} antialiased`}>
          <UserPreferencesProvider>
            <HeaderNav />
            {children}
          </UserPreferencesProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
