"use client";

import { useState } from "react";
import { readinessPercent as pct, type CheckStatus, type ChecklistTile, type TableTile } from "@/lib/demo/staticTiles";

const STATUS: Record<CheckStatus, { label: string; style: string }> = {
  done: { label: "Done", style: "bg-green-100 text-green-900" },
  in_progress: { label: "In progress", style: "bg-amber-100 text-amber-900" },
  not_started: { label: "Not started", style: "bg-stone-200 text-stone-700" },
};

/** A static demo tile: fixed data, a Preview label, and an Add button that saves nothing. */
export function StaticTileView({ tile, rows }: { tile: TableTile | ChecklistTile; rows?: TableTile["rows"] }) {
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <main className="flex flex-col gap-4 p-4 md:p-6" data-testid="static-tile">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">
            {tile.title}
            <span className="ml-3 rounded-full bg-amber-100 px-2 py-0.5 align-middle text-xs font-semibold uppercase tracking-wide text-amber-900" data-testid="preview-label">
              Preview
            </span>
          </h1>
          <p className="text-sm text-stone-600">
            {tile.blurb} Sample data for the demo.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setMsg("Demo only: nothing is saved.")} data-testid="static-add">
          {tile.add}
        </button>
      </div>
      {msg && (
        <p role="status" className="rounded bg-amber-50 p-2 text-sm text-amber-900" data-testid="static-msg">
          {msg}
        </p>
      )}
      {tile.kind === "table" ? (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-stone-50 text-left text-stone-600">
              <tr>
                {tile.columns.map((c) => (
                  <th key={c} className="p-3">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(rows ?? tile.rows).length === 0 && (
                <tr>
                  <td colSpan={tile.columns.length} className="p-4 text-center text-stone-500">
                    Nothing assigned to your role.
                  </td>
                </tr>
              )}
              {(rows ?? tile.rows).map((r, i) => (
                <tr key={i} className="border-t" data-testid="static-row">
                  {r.cells.map((c, k) => (
                    <td key={k} className={`p-3 ${k === 0 ? "font-medium" : "text-stone-700"}`}>
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {tile.groups.map((g) => (
            <section key={g.name} className="rounded-xl border bg-white p-4" data-testid="readiness-group">
              <div className="flex items-baseline justify-between">
                <h2 className="font-semibold">{g.name}</h2>
                <span className="text-sm font-semibold text-rose-800">{pct(g.items)}%</span>
              </div>
              <div className="my-2 h-2 rounded bg-stone-100" aria-hidden>
                <div className="h-2 rounded bg-rose-700" style={{ width: `${pct(g.items)}%` }} />
              </div>
              <ul className="flex flex-col gap-1.5 text-sm">
                {g.items.map((i) => (
                  <li key={i.label} className="flex items-center justify-between gap-2">
                    <span>{i.label}</span>
                    <span className={`whitespace-nowrap rounded px-2 py-0.5 text-xs ${STATUS[i.status].style}`}>{STATUS[i.status].label}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
