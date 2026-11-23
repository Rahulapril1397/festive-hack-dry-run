export function ComingSoon({ title, note }: { title: string; note?: string }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 bg-white p-8 text-center" data-testid="coming-soon">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm text-stone-500">{note ?? "Coming soon — planned for a later stage."}</p>
    </div>
  );
}
