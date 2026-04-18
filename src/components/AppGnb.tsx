"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/import", label: "수입" },
  { href: "/export", label: "수출" },
] as const;

export function AppGnb() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/90 bg-white shadow-sm">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-6 px-4 sm:px-6 lg:px-8">
        <Link
          href="/import"
          className="shrink-0 text-base font-semibold tracking-tight text-slate-900"
        >
          철강 수출입
        </Link>

        <nav
          className="flex items-center gap-1 rounded-lg bg-slate-100/90 p-1 ring-1 ring-slate-200/80"
          aria-label="주요 메뉴"
        >
          {NAV.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/80"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
