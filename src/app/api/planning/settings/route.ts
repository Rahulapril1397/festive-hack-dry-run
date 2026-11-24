import { handle, json, parseBody } from "@/lib/http";
import { getSession, requirePermission } from "@/lib/authz";
import { SettingsInput } from "@/contracts/planning";
import { saveSettings } from "@/domain/planning/service";

/** planning.write. PUT venue, station, airport and the ratios (room size, beds, cleaners, tea staff, vehicles). Only sent fields change. */
export const PUT = handle(async (req: Request) => {
  const s = await getSession();
  const ctx = await requirePermission(s, "planning.write", s?.weddingId ?? "");
  return json(await saveSettings(ctx.weddingId, await parseBody(req, SettingsInput)));
});
