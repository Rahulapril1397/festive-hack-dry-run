import { notFound } from "next/navigation";
import { requirePage } from "@/components/shell/guard";
import { AppError } from "@/lib/errors";
import { getVendor, listCategories } from "@/domain/vendors/service";
import { VendorForm } from "../../VendorForm";

export const dynamic = "force-dynamic";

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requirePage("vendors.manage", `/vendors/${id}/edit`);
  const [vendor, categories] = await Promise.all([
    getVendor(s, id).catch((e) => {
      if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
      throw e;
    }),
    listCategories(s.weddingId),
  ]);
  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Edit {vendor.name}</h1>
      <VendorForm categories={categories} initial={vendor} />
    </main>
  );
}
