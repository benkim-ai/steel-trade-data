"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV = [
  { href: "/import", label: "수입" },
  { href: "/export", label: "수출" },
] as const;

export function AppGnb() {
  const pathname = usePathname();
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const updateStatus = () => setIsOnline(window.navigator.onLine);

    updateStatus();
    window.addEventListener("online", updateStatus);
    window.addEventListener("offline", updateStatus);

    return () => {
      window.removeEventListener("online", updateStatus);
      window.removeEventListener("offline", updateStatus);
    };
  }, []);

  return (
    <header className="relative z-40 px-4 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4">
        <Link
          href="/import"
          className="shrink-0 rounded-full border border-[#303030]/20 bg-white/36 px-6 py-3 text-lg font-semibold tracking-tight text-[#303030] shadow-sm backdrop-blur-xl transition hover:bg-white/52"
        >
          Steel Trade Data
        </Link>

        <nav
          className="glass-surface fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-1 rounded-full p-1"
          aria-label="주요 메뉴"
        >
          {NAV.map(({ href, label }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-full px-5 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? "bg-[#303030] text-white shadow-sm"
                    : "text-neutral-700 hover:bg-white/44 hover:text-[#303030]"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <span className="glass-surface inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-medium text-neutral-800">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isOnline ? "bg-emerald-500" : "bg-red-500"
              }`}
              aria-hidden="true"
            />
            {isOnline ? "API Live" : "API Offline"}
          </span>
        </div>
      </div>
    </header>
  );
}
