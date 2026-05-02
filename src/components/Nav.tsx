"use client";

import type { Route } from "next";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { SignInButton, UserButton, useAuth } from "@clerk/nextjs";
import { useMirroredUser } from "@/lib/use-mirrored-user";
import { userChecklistRoute, userRoute, userTripsRoute } from "@/lib/routes";

type NavHref =
  | Route<"/">
  | Route<"/add">
  | Route<"/checklist">
  | Route<`/user/${string}`>
  | Route<`/user/${string}/checklist`>
  | Route<`/user/${string}/trips`>;

type NavLink = {
  href: NavHref;
  label: string;
  exact?: boolean;
};

const publicLinks: NavLink[] = [
  { href: "/", label: "Explore" },
  { href: "/checklist", label: "Checklist" },
];

export default function Nav() {
  const pathname = usePathname();
  const { isSignedIn } = useAuth();
  const { user } = useMirroredUser();

  const username = user?.username;
  const profileHref = username ? userRoute(username) : "/";
  const tripsHref = username ? userTripsRoute(username) : "/";
  const checklistHref = username ? userChecklistRoute(username) : "/checklist";

  const signedInLinks: NavLink[] = [
    { href: "/", label: "Explore" },
    ...(username
      ? [
          { href: profileHref, label: "My Profile", exact: true },
          { href: tripsHref, label: "My Trips" },
          { href: checklistHref, label: "My Checklist" },
        ]
      : []),
    { href: "/add", label: "Add" },
  ];

  const links = isSignedIn ? signedInLinks : publicLinks;
  const isActive = (link: NavLink) =>
    pathname === link.href ||
    (!link.exact && link.href !== "/" && pathname.startsWith(`${link.href}/`));

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
                key={link.label}
                href={link.href}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                  isActive(link)
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
