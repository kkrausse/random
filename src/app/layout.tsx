import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import "leaflet/dist/leaflet.css";
import Nav from "@/components/Nav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Bird Log",
  description: "Personal bird sighting tracker",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} antialiased bg-gray-50 font-[family-name:var(--font-geist-sans)]`}>
        <Nav />
        <main className="max-w-5xl mx-auto">{children}</main>
      </body>
    </html>
  );
}
