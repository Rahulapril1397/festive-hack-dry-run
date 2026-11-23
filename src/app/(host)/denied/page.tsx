export default async function Denied({ searchParams }: { searchParams: Promise<{ need?: string }> }) {
  const { need } = await searchParams;
  return (
    <main className="p-6" data-testid="access-denied">
      <h1 className="text-2xl font-bold">Access denied</h1>
      <p className="mt-2 text-stone-600">Your role does not have access to this screen{need ? ` (needs ${need})` : ""}.</p>
    </main>
  );
}
