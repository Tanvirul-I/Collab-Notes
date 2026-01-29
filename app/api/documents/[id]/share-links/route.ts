import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyRequestUser } from "@/lib/auth";

const createShareLinkSchema = z.object({
  permission: z.enum(["viewer", "editor"]),
  expiresAt: z.string().datetime().optional().nullable()
});

function createShareToken() {
  return randomBytes(24).toString("base64url");
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const document = await prisma.document.findUnique({
    where: { id: params.id }
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (document.ownerId !== authUser.userId) {
    return NextResponse.json(
      { error: "Only the document owner can create share links" },
      { status: 403 }
    );
  }

  const payload = await request.json();
  const parsed = createShareLinkSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const token = createShareToken();
  const expiresAt = parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null;
  if (expiresAt && Number.isNaN(expiresAt.getTime())) {
    return NextResponse.json({ error: "Invalid expiresAt value" }, { status: 400 });
  }

  if (expiresAt && expiresAt <= new Date()) {
    return NextResponse.json({ error: "expiresAt must be in the future" }, { status: 400 });
  }

  const link = await prisma.documentShareLink.create({
    data: {
      documentId: params.id,
      token,
      permission: parsed.data.permission,
      expiresAt,
      createdById: authUser.userId
    }
  });

  const shareUrl = `${request.nextUrl.origin}/app/documents/${params.id}?shareToken=${token}`;

  return NextResponse.json({ link, shareUrl }, { status: 201 });
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const document = await prisma.document.findUnique({
    where: { id: params.id }
  });

  if (!document) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  if (document.ownerId !== authUser.userId) {
    return NextResponse.json(
      { error: "Only the document owner can view share links" },
      { status: 403 }
    );
  }

  const links = await prisma.documentShareLink.findMany({
    where: { documentId: params.id },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ links });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const linkId = searchParams.get("linkId");
  if (!linkId) {
    return NextResponse.json(
      { error: "linkId query parameter required" },
      { status: 400 }
    );
  }

  const link = await prisma.documentShareLink.findUnique({
    where: { id: linkId },
    include: { document: true }
  });

  if (!link || link.documentId !== params.id) {
    return NextResponse.json({ error: "Share link not found" }, { status: 404 });
  }

  if (link.document.ownerId !== authUser.userId) {
    return NextResponse.json(
      { error: "Only the document owner can revoke share links" },
      { status: 403 }
    );
  }

  await prisma.documentShareLink.delete({ where: { id: linkId } });
  return NextResponse.json({ success: true });
}
