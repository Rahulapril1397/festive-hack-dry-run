import { publicRoute } from "@/lib/http";
import { NextResponse } from "next/server";
import { authClient } from "@/lib/db/auth";
import { env } from "@/lib/env";

export async function POST() {
  publicRoute("signs the caller out of their own session");
  const supabase = await authClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", env().APP_URL) /* behind the load balancer req.url is the pod address */, 303);
}
