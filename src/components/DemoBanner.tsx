export function DemoBanner({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="bg-amber-400 px-3 py-1 text-center text-sm font-semibold text-amber-950">
      Demo wedding — synthetic data
    </div>
  );
}
