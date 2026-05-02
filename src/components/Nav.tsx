"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";

const publicLinks = [
  { href: "/", label: "Explore" },
  { href: "/checklist", label: "Checklist" },
  { href: "/search", label: "Search" },
];

const signedInLinks = [
  { href: "/", label: "Explore" },
  { href: "/", label: "My Profile" },
  { href: "/trips", label: "My Trips" },
  { href: "/checklist", label: "My Checklist" },
  { href: "/search", label: "Search" },
  { href: "/add", label: "Add" },
];

export default function Nav() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();

  const links = isSignedIn ? signedInLinks : publicLinks;

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="max-w-5xl mx-auto px-4">
        <div className="flex items-center justify-between h-14">
          <Link href="/" className="flex items-center gap-2 font-bold text-lg text-green-700">
            <Image src="/quail-logo.png" alt="" width={32} height={32} className="rounded-sm" unoptimized />
            BirdMog
          </Link>
          <div className="flex items-center gap-1 overflow-x-auto">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  pathname === link.href
                    ? "bg-green-100 text-green-800"
                    : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                }`}
              >
                {link.label}
              </Link>
            ))}
            <div className="ml-2 flex items-center">
              {isSignedIn ? (
                <UserButton />
              ) : (
                <SignInButton mode="redirect">
                  <button className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors">
                    Sign In
                  </button>
                </SignInButton>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}
