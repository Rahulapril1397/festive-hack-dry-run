export default function NoAccess() {
  return (
    <main className="p-6" data-testid="access-denied">
      <h1 className="text-2xl font-bold">No screens yet</h1>
      <p className="mt-2 text-stone-600">Your role has no screens in this wedding. Ask an administrator to adjust your role.</p>
    </main>
  );
}
