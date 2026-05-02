import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Geist } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import Nav from "@/components/Nav";
import { ClerkProvider } from "@clerk/nextjs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BirdMog",
  description: "Personal bird sighting tracker",
  metadataBase: new URL(process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000"),
  openGraph: {
    title: "BirdMog",
    description: "Personal bird sighting tracker",
    siteName: "BirdMog",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "BirdMog",
    description: "Personal bird sighting tracker",
  },
};

async function AuthNav() {
  await connection();
  return (
    <ClerkProvider>
      <Nav />
    </ClerkProvider>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased bg-gray-50 font-[family-name:var(--font-geist-sans)]`}>
        <Suspense fallback={
          <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
            <div className="max-w-5xl mx-auto px-4 h-14" />
          </nav>
        }>
          <AuthNav />
        </Suspense>
        <main className="max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
