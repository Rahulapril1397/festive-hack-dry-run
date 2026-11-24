"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { NavItem } from "./navConfig";

export function SideNav({ items }: { items: NavItem[] }) {
  const path = usePathname();
  const isActive = (href: string) => path === href || (href !== "/host" && path.startsWith(href + "/")) || (href === "/stage" && path.startsWith("/stage"));
  return (
    <nav className="flex gap-1 overflow-x-auto p-2 md:flex-col md:overflow-visible" data-testid="side-nav">
      {items.map((i) => (
        <Link
          key={i.key}
          href={i.href}
          data-testid={`nav-${i.key}`}
          className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm ${isActive(i.href) ? "border-l-4 border-amber-500 bg-rose-100 font-semibold text-rose-900" : "border-l-4 border-transparent text-stone-700 hover:bg-amber-100"}`}
        >
          {i.label}
          {i.soon && <span className="ml-2 rounded bg-stone-200 px-1 text-[10px] uppercase text-stone-600">soon</span>}
        </Link>
      ))}
    </nav>
  );
}
