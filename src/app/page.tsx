import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-3xl font-bold text-rose-800">Pehle Aap</h1>
      <p className="text-stone-600">Guests: scan the QR at the venue to check in.</p>
      <Link className="btn-primary" href="/stage">
        Staff sign in
      </Link>
    </main>
  );
}
