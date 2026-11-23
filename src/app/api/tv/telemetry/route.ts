/**
 * STUB — owned by E2 (increments the chime metric). Replace when E2 ships.
 * Contract: POST { event: "chime", eventId?, announcementId?, reason? } → 204.
 */
export async function POST(req: Request) {
  await req.text().catch(() => "");
  return new Response(null, { status: 204 });
}
