import { z } from "zod";
import { db } from "@/lib/db/service";
import { eventForTvKey } from "@/domain/queue/service";
import { isEnabled } from "@/lib/flags";
import { recordTts } from "@/lib/metrics";
import { sarvam } from "@/lib/sarvam/client";
import { audioCache } from "@/lib/sarvam/audioCache";
import { announcementAudio } from "@/lib/sarvam/announce";
import { isAppLanguage } from "@/lib/sarvam/languages";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Contract C3 (E2). GET /api/tv/announcement/:stageLogId/audio?key=<tv_key>
 * 200 audio/* | 204 (TTS off, failed or timed out → the TV chimes) | 403 bad key | 404.
 * Language: the called family's language, else the event's. Text: announcementText(token, lang).
 */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new Response(null, { status: 404 });

  const { data: log } = await db()
    .from("stage_log")
    .select("id, event_id, token_number, action, queue_entry_id")
    .eq("id", id)
    .maybeSingle();
  if (!log || log.action !== "called" || !log.token_number) return new Response(null, { status: 404 });

  const ev = await eventForTvKey(log.event_id, new URL(req.url).searchParams.get("key"));
  if (!ev) return new Response(null, { status: 403 });

  let lang: string | null = null;
  if (log.queue_entry_id) {
    const { data } = await db().from("queue_entry").select("family:family_id(language)").eq("id", log.queue_entry_id).maybeSingle();
    lang = (data?.family as unknown as { language?: string } | null)?.language ?? null;
  }
  if (!isAppLanguage(lang)) {
    const { data } = await db().from("event").select("language").eq("id", log.event_id).maybeSingle();
    lang = data?.language ?? "en";
  }

  return announcementAudio(log.token_number, isAppLanguage(lang) ? lang : "en", {
    voiceCallsOn: () => isEnabled("voice_calls"),
    client: sarvam(),
    cache: audioCache,
    record: recordTts,
  });
}
