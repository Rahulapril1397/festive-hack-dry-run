import { requirePage } from "@/components/shell/guard";
import { album } from "@/domain/photos/service";

export const dynamic = "force-dynamic";

export default async function AlbumPage() {
  const s = await requirePage("photos.review", "/host/album");
  const groups = await album(s);
  return (
    <main className="flex flex-col gap-6 p-4 md:p-6">
      <h1 className="text-2xl font-bold">Album</h1>
      <p className="text-sm text-stone-600">Confirmed photos, by family token. Only human-confirmed matches appear here.</p>
      {groups.length === 0 && <p className="text-stone-500">No confirmed photos yet.</p>}
      {groups.map((g) => (
        <section key={g.token}>
          <h2 className="mb-2 font-semibold">Token {g.token}</h2>
          <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
            {g.photos.map((p) =>
              // eslint-disable-next-line @next/next/no-img-element
              p.url ? <img key={p.id} src={p.url} alt={`Token ${g.token}`} className="aspect-square w-full rounded object-cover" loading="lazy" /> : null,
            )}
          </div>
        </section>
      ))}
    </main>
  );
}
