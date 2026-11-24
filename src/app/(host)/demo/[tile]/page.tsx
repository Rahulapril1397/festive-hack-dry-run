import { notFound } from "next/navigation";
import { requireAnyPage } from "@/components/shell/guard";
import { StaticTileView } from "@/components/shell/StaticTile";
import { TILES, audiencesFor, isTileKey } from "@/lib/demo/staticTiles";

export const dynamic = "force-dynamic";

/** Static demo tiles (Vendors, Event readiness, Tasks, Gift ledger): fixed data, permission-gated like the real screens. */
export default async function DemoTilePage({ params }: { params: Promise<{ tile: string }> }) {
  const { tile } = await params;
  if (!isTileKey(tile)) notFound();
  const def = TILES[tile];
  const s = await requireAnyPage(def.permissions, `/demo/${tile}`);
  const rows = tile === "tasks" && def.kind === "table" ? def.rows.filter((r) => r.audience && audiencesFor(s.roles, s.isSuperAdmin).includes(r.audience)) : undefined;
  return <StaticTileView tile={def} rows={rows} />;
}
