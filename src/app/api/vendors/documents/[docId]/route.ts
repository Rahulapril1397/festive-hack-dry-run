import { NextResponse } from "next/server";
import { handle, json } from "@/lib/http";
import { requireSelected } from "@/lib/authz";
import { deleteDocument, documentDownloadUrl } from "@/domain/vendors/service";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ docId: string }> };

/** vendors.documents.read: redirect to a 5-minute signed download URL. */
export const GET = handle(async (_req: Request, { params }: P) => {
  const s = await requireSelected("vendors.documents.read");
  const url = await documentDownloadUrl(s, (await params).docId);
  return NextResponse.redirect(url, { status: 302, headers: { "cache-control": "no-store" } });
});

export const DELETE = handle(async (_req: Request, { params }: P) => {
  const s = await requireSelected("vendors.manage");
  await deleteDocument(s, (await params).docId);
  return json({ ok: true });
});
