import { NextResponse } from "next/server";
import { hashPassword } from "better-auth/crypto";
import { neon } from "@neondatabase/serverless";

export async function POST(request: Request) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { email, password } = await request.json();

  if (typeof email !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Email and password are required" },
      { status: 400 },
    );
  }

  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters" },
      { status: 400 },
    );
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 500 },
    );
  }

  const sql = neon(databaseUrl);
  const passwordHash = await hashPassword(password);

  const rows = await sql(
    `update account as a
       set password = $1, updated_at = now()
      from "user" as u
     where a.user_id = u.id
       and u.email = $2
       and a.provider_id = 'credential'
     returning u.email`,
    [passwordHash, email],
  );

  if (rows.length === 0) {
    return NextResponse.json(
      { error: "No email/password account found for that email" },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true });
}
