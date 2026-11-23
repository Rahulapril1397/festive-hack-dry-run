import { NextResponse } from "next/server";
import { authClient } from "@/lib/db/auth";

export async function POST(req: Request) {
  const supabase = await authClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
