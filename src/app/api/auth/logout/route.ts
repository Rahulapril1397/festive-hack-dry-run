import { publicRoute } from "@/lib/http";
import { NextResponse } from "next/server";
import { authClient } from "@/lib/db/auth";

export async function POST(req: Request) {
  publicRoute("signs the caller out of their own session");
  const supabase = await authClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", req.url), 303);
}
