import { loadGuest } from "@/domain/rsvp/service";
import { DemoBanner } from "@/components/shell/DemoBanner";
import { EN } from "@/i18n";
import { PinkyBua } from "@/components/pinkybua/PinkyBua";

export const dynamic = "force-dynamic";

export default async function GuestLayout({ children, params }: { children: React.ReactNode; params: Promise<{ key: string }> }) {
  const { key } = await params;
  const g = await loadGuest(key);
  if (!g) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-8 text-center" data-testid="link-invalid">
        <h1 className="text-2xl font-bold text-rose-800">{EN["link.invalid"]}</h1>
        <p className="text-stone-600">{EN["link.invalidHelp"]}</p>
      </main>
    );
  }
  return (
    <div className="min-h-dvh bg-gradient-to-b from-rose-50 to-stone-50">
      <DemoBanner show={g.wedding.isDemo} />
      <div className="mx-auto max-w-md px-4 pb-24 pt-6">{children}</div>
      <PinkyBua mode="guest" language={g.family.language} />
    </div>
  );
}
