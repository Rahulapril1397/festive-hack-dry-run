"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders the server page every `ms` while the tab is visible (paused when hidden). */
export function AutoRefresh({ ms = 5000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => document.visibilityState === "visible" && router.refresh(), ms);
    const onVis = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router, ms]);
  return null;
}
