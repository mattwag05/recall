import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/recall/toaster";
import { THEME_INIT_SCRIPT } from "@/components/recall/theme-toggle";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Recall",
  description: "A personal AI knowledge base. Save anything; remember everything.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the pre-paint script below sets data-theme on
    // <html>, so the client DOM intentionally differs from the server HTML.
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies a stored light theme before first paint — see theme-toggle.tsx. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <main>{children}</main>
        <Toaster />
      </body>
    </html>
  );
}
