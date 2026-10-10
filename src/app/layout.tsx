import type { Metadata, Viewport } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { AppShell, type ShellSpend } from "@/components/AppShell";
import { usd } from "@/engine/money";
import { getState, isDemo } from "@/server/runtime";
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
  const { run } = await getState();
  const spend: ShellSpend | null = run ? { title: "Last run", spent: usd(run.spentMicros), cap: usd(run.capMicros), ratio: run.capMicros > 0 ? run.spentMicros / run.capMicros : 0, note: run.demo ? "Sample data, nothing charged." : undefined } : null;
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh bg-page text-ink">
        <AppShell demo={isDemo()} spend={spend}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}
