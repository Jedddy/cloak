import Link from "next/link";

const links = [
  { href: "/", label: "Packages" },
  { href: "/packages/new", label: "New package" },
  { href: "/settings", label: "Settings" },
];

export function AppNav() {
  return (
    <header className="border-b border-border bg-background">
      <div className="mx-auto flex h-12 w-full max-w-6xl items-center gap-6 px-4">
        <Link href="/" className="text-base font-semibold tracking-tight">
          SentinelDesk
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
