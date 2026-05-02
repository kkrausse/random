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
  title: "Bird Log",
  description: "Personal bird sighting tracker",
};

async function AppShell({ children }: { children: React.ReactNode }) {
  await connection();
  return (
    <ClerkProvider>
      <Nav />
      <main className="max-w-5xl mx-auto">{children}</main>
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
        <Suspense>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}
