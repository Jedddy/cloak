"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Packages", narrow: true },
  { href: "/packages/new", label: "New package", narrow: false },
  { href: "/settings", label: "Settings", narrow: true },
];

export function NavLinks() {
  return <NavLinkList pathname={usePathname()} />;
}

/** Renders without the URL, so that it can be the Suspense fallback. */
export function NavLinkList({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Primary" className="flex items-center gap-0.5">
      {links.map((link) => {
        const active =
          link.href === "/"
            ? pathname === "/" ||
              (pathname.startsWith("/packages/") && pathname !== "/packages/new")
            : pathname === link.href;

        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground",
              active && "bg-accent font-medium text-foreground",
              !link.narrow && "hidden sm:block",
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
