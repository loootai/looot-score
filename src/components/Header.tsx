"use client";

import Image from "next/image";
import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { useSyncExternalStore } from "react";

function useIsDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener("themechange", cb);
      return () => window.removeEventListener("themechange", cb);
    },
    () => document.documentElement.classList.contains("dark"),
    () => false,
  );
}

/** Top bar: brand, a demo badge when the data is sample data, and the theme switch. */
export function Header({ demo }: { demo: boolean }) {
  const dark = useIsDark();
  const toggle = () => {
    const next = dark ? "light" : "dark";
    document.documentElement.classList.toggle("dark", next === "dark");
    try {
      localStorage.setItem("theme", next);
    } catch {}
    window.dispatchEvent(new CustomEvent("themechange"));
  };
  return (
    <header className="sticky top-0 z-10 border-b border-line bg-page/90 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-[1200px] items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-medium tracking-tight">
          <Image src={dark ? "/brand/looot-mark-white.svg" : "/brand/looot-mark.svg"} alt="" width={20} height={20} priority />
          <span>looot-score</span>
        </Link>
        {demo && <span className="rounded-control border border-line-strong bg-amber-soft px-1.5 py-0.5 text-11 font-medium text-amber">Demo data. No looot calls.</span>}
        <nav className="ml-2 flex items-center gap-1 text-13">
          <Link href="/" className="rounded-control px-2 py-1 text-mute hover:bg-hover hover:text-ink">Leads</Link>
          <Link href="/icp" className="rounded-control px-2 py-1 text-mute hover:bg-hover hover:text-ink">ICP editor</Link>
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <a href="https://github.com/loootai/looot-score" className="hidden rounded-control px-2 py-1 text-mute hover:bg-hover hover:text-ink sm:block">GitHub</a>
          <button type="button" onClick={toggle} aria-label="Toggle dark mode" className="grid size-8 place-items-center rounded-control text-mute hover:bg-hover hover:text-ink">
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
    </header>
  );
}
