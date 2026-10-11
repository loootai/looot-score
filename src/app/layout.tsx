import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell, type ShellSpend, type ShellSpendRow } from "@/components/AppShell";
import { usd } from "@/engine/money";
import { currentCsrf, requireAdminPage } from "@/lib/auth/guard";
import { isPublicPath } from "@/lib/auth/routes";
import type { PeriodStatus } from "@/engine/budget";
import { budgetStatus, isDemo } from "@/server/runtime";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "looot-score", template: "%s · looot-score" },
  description: "Open-source lead and ICP fit scoring. Built on looot.",
  icons: { icon: "/brand/looot-mark.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F7F8F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0A1512" },
  ],
};

// Sets the theme class before the first paint. ?theme=dark or ?theme=light overrides the saved choice for one view.
const themeScript = `(function(){try{var q=new URLSearchParams(location.search).get("theme");var t=q||localStorage.getItem("theme")||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const path = (await headers()).get("x-score-path") ?? "";
  // Public routes (the sign-in page) render with no stored data and no admin navigation.
  if (path !== "" && isPublicPath(path)) {
    return (
      <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        </head>
        <body className="min-h-dvh bg-page text-ink">
          <main className="mx-auto min-h-dvh max-w-xl px-4 py-10">{children}</main>
        </body>
      </html>
    );
  }
  const gate = await requireAdminPage();
  const csrf = await currentCsrf();
  const b = await budgetStatus();
  const row = (label: string, p: PeriodStatus): ShellSpendRow => ({ label, used: usd(p.usedMicros), reserved: usd(p.reservedMicros), remaining: usd(p.remainingMicros), cap: usd(p.limitMicros), ratio: p.limitMicros > 0 ? (p.usedMicros + p.reservedMicros) / p.limitMicros : 0 });
  const spend: ShellSpend = { title: "Spend budget", rows: [row("Today", b.day), row("Month", b.month)], note: isDemo() ? "Sample data, nothing charged." : undefined };
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <meta name="score-csrf" content={csrf} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <AppShell demo={gate.policy.mode === "open-demo"} signOut={gate.policy.mode === "login"} spend={spend}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
