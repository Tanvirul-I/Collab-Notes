import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { hashPassword, setAuthCookie, signUserToken } from "@/lib/auth";

const signupSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6)
});

const avatarPalette = ["#0ea5e9", "#8b5cf6", "#22c55e", "#f97316", "#ec4899"];

export async function POST(request: Request) {
  const body = await request.json();
  const parsed = signupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (existing) {
    return NextResponse.json({ error: "User already exists" }, { status: 409 });
  }

  const passwordHash = await hashPassword(parsed.data.password);
  const avatarColor = avatarPalette[Math.floor(Math.random() * avatarPalette.length)];

  const user = await prisma.user.create({
    data: {
      email: parsed.data.email,
      name: parsed.data.name,
      passwordHash,
      avatarColor
    }
  });

  const token = await signUserToken({ userId: user.id, email: user.email });
  const response = NextResponse.json({ user: { id: user.id, email: user.email, name: user.name } });
  setAuthCookie(response, token);
  return response;
}
