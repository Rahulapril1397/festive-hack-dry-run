import { requirePage } from "@/components/shell/guard";
import { listCategories } from "@/domain/vendors/service";
import { VendorForm } from "../VendorForm";

export const dynamic = "force-dynamic";

export default async function NewVendorPage() {
  const s = await requirePage("vendors.manage", "/vendors/new");
  return (
    <main className="flex flex-col gap-4 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Add vendor</h1>
      <VendorForm categories={await listCategories(s.weddingId)} />
    </main>
  );
}
