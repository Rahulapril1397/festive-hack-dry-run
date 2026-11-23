"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type Item = { id: string; title: string; body: string; link: string | null; createdAt: string; read: boolean };

/** 🔔 in the staff top bar: reminders and escalations from the job runner. Polls every minute. */
export function NotificationBell() {
  const [items, setItems] = useState<Item[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/notifications", { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as { items: Item[]; unread: number };
      setItems(j.items);
      setUnread(j.unread);
    } catch {
      /* offline: keep the last list */
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => document.visibilityState === "visible" && void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const markAll = async () => {
    await fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    setUnread(0);
  };
  const markOne = (id: string) => {
    void fetch("/api/notifications/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [id] }) });
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, read: true } : x)));
    setUnread((n) => Math.max(0, n - (items.find((x) => x.id === id && !x.read) ? 1 : 0)));
    setOpen(false);
  };

  return (
    <div className="relative" ref={box}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full p-1.5 hover:bg-stone-100"
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        aria-expanded={open}
        data-testid="notification-bell"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" strokeLinecap="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-rose-700 px-1 text-center text-[10px] font-bold leading-4 text-white" data-testid="notification-count">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-stone-200 bg-white shadow-lg" role="dialog" aria-label="Notifications">
          <div className="flex items-center justify-between border-b px-3 py-2">
            <span className="font-semibold">Notifications</span>
            {unread > 0 && (
              <button className="text-xs text-rose-800 underline" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto">
            {items.length === 0 && <li className="p-4 text-sm text-stone-500">Nothing yet. Task reminders and escalations show up here.</li>}
            {items.map((n) => {
              const inner = (
                <>
                  <p className={`text-sm ${n.read ? "text-stone-600" : "font-semibold"}`}>{n.title}</p>
                  {n.body && <p className="text-xs text-stone-500">{n.body}</p>}
                  <p className="mt-0.5 text-[11px] text-stone-400">{new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</p>
                </>
              );
              return (
                <li key={n.id} className={`border-b last:border-0 ${n.read ? "" : "bg-rose-50/60"}`}>
                  {n.link ? (
                    <Link href={n.link} className="block px-3 py-2 hover:bg-stone-50" onClick={() => markOne(n.id)}>
                      {inner}
                    </Link>
                  ) : (
                    <button className="block w-full px-3 py-2 text-left hover:bg-stone-50" onClick={() => markOne(n.id)}>
                      {inner}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
