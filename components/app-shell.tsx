import Link from "next/link";

const TABS = [
  { href: "/", label: "Journal", icon: "M4 5h16M4 12h16M4 19h10" },
  { href: "/tendances", label: "Tendances", icon: "M4 18l5-6 4 4 7-9" },
  { href: "/archives", label: "Archives", icon: "M4 7h16v12H4zM4 7l2-3h12l2 3" },
  { href: "/reglages", label: "Réglages", icon: "M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2m12 0h2M12 4v2m0 12v2" },
] as const;

/** Mise en page commune : contenu centré + barre d'onglets en bas (pensée pour le pouce). */
export function AppShell({ active, children }: { active: (typeof TABS)[number]["href"]; children: React.ReactNode }) {
  return (
    <>
      <main className="mx-auto w-full max-w-2xl px-4 pb-28 pt-5">{children}</main>
      <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-background/95 backdrop-blur">
        <ul className="mx-auto grid max-w-2xl grid-cols-4 pb-[env(safe-area-inset-bottom)]">
          {TABS.map((t) => {
            const on = t.href === active;
            return (
              <li key={t.href}>
                <Link
                  href={t.href}
                  className={`flex flex-col items-center gap-1 py-2.5 text-[11px] ${on ? "text-accent" : "text-muted"}`}
                  aria-current={on ? "page" : undefined}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d={t.icon} />
                  </svg>
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
