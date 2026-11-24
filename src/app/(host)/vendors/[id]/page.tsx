import { notFound } from "next/navigation";
import { requirePage } from "@/components/shell/guard";
import { AppError } from "@/lib/errors";
import { listEvents } from "@/lib/db/service";
import { getVendor } from "@/domain/vendors/service";
import { VendorDetailView } from "./VendorDetailView";

export const dynamic = "force-dynamic";

export default async function VendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePage("vendors.contacts.read", `/vendors/${id}`);
  const vendor = await getVendor(s, id).catch((e) => {
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const events = await listEvents(s.weddingId);
  return <VendorDetailView vendor={vendor} events={events.map((e) => ({ id: e.id, name: e.name }))} />;
}
