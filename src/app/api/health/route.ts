import { publicRoute } from "@/lib/http";
export const dynamic = "force-dynamic";

export function GET() {
  publicRoute("liveness probe, returns no data");
  return Response.json({ ok: true, sha: process.env.GIT_SHA ?? "dev" }, { headers: { "cache-control": "no-store" } });
}
