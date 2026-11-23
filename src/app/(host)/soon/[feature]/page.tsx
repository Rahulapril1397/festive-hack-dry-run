import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/shell/ComingSoon";
import { SOON_FEATURES } from "@/components/shell/navConfig";
import { requirePage } from "@/components/shell/guard";

export default async function SoonPage({ params }: { params: Promise<{ feature: string }> }) {
  const { feature } = await params;
  const title = SOON_FEATURES[feature];
  if (!title) notFound();
  await requirePage("host.read", `/soon/${feature}`);
  return (
    <main className="p-6">
      <h1 className="mb-4 text-2xl font-bold">{title}</h1>
      <ComingSoon title={title} />
    </main>
  );
}
