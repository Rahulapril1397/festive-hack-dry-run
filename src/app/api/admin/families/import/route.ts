import { z } from "zod";
import { handle, json } from "@/lib/http";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/domain/admin/guard";
import { importFamilies } from "@/domain/admin/service";

const MAX_BYTES = 1_000_000;

/**
 * families.write. Body: CSV (text/csv) or multipart field "file". Columns: name, phone, language,
 * headcount_max. Bad rows are reported, good rows are imported. Accept: text/csv → result CSV.
 */
export const POST = handle(async (req: Request) => {
  const url = new URL(req.url);
  const weddingParam = url.searchParams.get("weddingId");
  if (weddingParam && !z.string().uuid().safeParse(weddingParam).success) throw new AppError("BAD_REQUEST", "Bad weddingId");
  const s = await requireAdmin("families.write", weddingParam ?? undefined);
  const weddingId = weddingParam ?? s.weddingId;

  let text: string;
  if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    const file = (await req.formData()).get("file");
    if (!(file instanceof File)) throw new AppError("BAD_REQUEST", "Attach the CSV as 'file'");
    if (file.size > MAX_BYTES) throw new AppError("BAD_REQUEST", "File too large (max 1 MB)");
    text = await file.text();
  } else {
    text = await req.text();
    if (text.length > MAX_BYTES) throw new AppError("BAD_REQUEST", "File too large (max 1 MB)");
  }
  const result = await importFamilies(s, weddingId, text);
  if ((req.headers.get("accept") ?? "").includes("text/csv")) {
    return new Response(result.csv, {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="family-links.csv"', "cache-control": "no-store", "x-import-summary": JSON.stringify(result.summary) },
    });
  }
  return json(result, { headers: { "cache-control": "no-store" } });
});
