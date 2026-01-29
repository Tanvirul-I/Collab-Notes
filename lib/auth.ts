import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "./prisma";

type JwtPayload = {
  userId: string;
  email: string;
};

const tokenCookieName = "collab_notes_token";
const tokenExpiresDays = 7;

export async function signUserToken(payload: JwtPayload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }

  const token = await new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${tokenExpiresDays}d`)
    .sign(new TextEncoder().encode(secret));

  return token;
}

export async function verifyRequestUser(req: NextRequest) {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }

  const cookie = req.cookies.get(tokenCookieName);
  
  if (!cookie) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(
      cookie.value,
      new TextEncoder().encode(secret)
    );
    
    // Validate that the payload has the required fields
    const jwtPayload = payload as JwtPayload;
    if (!jwtPayload.userId || !jwtPayload.email) {
      console.error("Invalid JWT payload:", payload);
      return null;
    }
    
    return jwtPayload;
  } catch (err) {
    console.error("JWT verification error:", err);
    return null;
  }
}

export function getAuthTokenValue(req: NextRequest) {
  return req.cookies.get(tokenCookieName)?.value ?? null;
}

export async function hashPassword(password: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function setAuthCookie(response: NextResponse, token: string) {
  response.cookies.set({
    name: tokenCookieName,
    value: token,
    httpOnly: true,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * tokenExpiresDays,
    sameSite: "lax"
  });
}

export async function getSessionUser() {
  const cookieStore = cookies();
  const token = cookieStore.get(tokenCookieName);
  if (!token) {
    return null;
  }

  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("JWT_SECRET is not set");
  }

  try {
    const { payload } = await jwtVerify(
      token.value,
      new TextEncoder().encode(secret)
    );
    const jwtPayload = payload as JwtPayload;
    
    // Validate that the payload has the required userId
    if (!jwtPayload.userId) {
      console.error("JWT payload missing userId");
      return null;
    }
    
    // Check if user still exists in database
    const user = await prisma.user.findUnique({ where: { id: jwtPayload.userId } });
    if (!user) {
      console.error("User from JWT not found in database:", jwtPayload.userId);
      return null;
    }
    
    return user;
  } catch (err) {
    console.error("Session validation error:", err);
    return null;
  }
}

export function redirectToLogin(req: NextRequest) {
  return NextResponse.redirect(new URL("/login", req.url));
}
