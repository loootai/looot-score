import type { LucideIcon } from "lucide-react";
import { ListChecks, SlidersHorizontal, Wallet } from "lucide-react";

export type ShellNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Page title in the header when it differs from the label. */
  title?: string;
  /** Heading the item sits under. Used only when the app has more than six items. */
  group?: string;
  /** Other path prefixes that keep this item highlighted, such as detail pages. */
  match?: string[];
  /** Primary action shown at the right of the page header. */
  action?: { label: string; href: string };
};

/** The only part of the sidebar shell that differs between looot apps. */
export const SHELL = {
  name: "looot-score",
  repoUrl: "https://github.com/loootai/looot-score",
  docsUrl: "https://docs.looot.ai",
  nav: <ShellNavItem[]>[
    { href: "/", label: "Leads", title: "Lead fit", icon: ListChecks, action: { label: "Score leads", href: "/#run" } },
    { href: "/icp", label: "ICP editor", icon: SlidersHorizontal },
    { href: "/costs", label: "Costs", title: "Costs and budget", icon: Wallet },
  ],
};
