import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyRequestUser } from "@/lib/auth";

const shareSchema = z.object({
  identifier: z.string().min(1),
  permission: z.enum(["viewer", "editor"])
});

// Share a document with another user
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

  // Only the owner can share the document
  if (document.ownerId !== authUser.userId) {
    return NextResponse.json(
      { error: "Only the document owner can share" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = shareSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  // Find the user to share with
  const targetUser = await prisma.user.findFirst({
    where: {
      OR: [{ email: parsed.data.identifier }, { name: parsed.data.identifier }]
    }
  });

  if (!targetUser) {
    return NextResponse.json(
      { error: "User not found with that email or username" },
      { status: 404 }
    );
  }

  // Cannot share with yourself
  if (targetUser.id === authUser.userId) {
    return NextResponse.json(
      { error: "Cannot share a document with yourself" },
      { status: 400 }
    );
  }

  // Create or update the share
  const share = await prisma.documentShare.upsert({
    where: {
      documentId_userId: {
        documentId: document.id,
        userId: targetUser.id
      }
    },
    update: {
      permission: parsed.data.permission
    },
    create: {
      documentId: document.id,
      userId: targetUser.id,
      permission: parsed.data.permission
    },
    include: {
      user: {
        select: { id: true, email: true, name: true, avatarColor: true }
      }
    }
  });

  return NextResponse.json({ share }, { status: 201 });
}

// List all shares for a document
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

  // Only the owner can view all shares
  if (document.ownerId !== authUser.userId) {
    return NextResponse.json(
      { error: "Only the document owner can view shares" },
      { status: 403 }
    );
  }

  const shares = await prisma.documentShare.findMany({
    where: { documentId: params.id },
    include: {
      user: {
        select: { id: true, email: true, name: true, avatarColor: true }
      }
    },
    orderBy: { createdAt: "desc" }
  });

  return NextResponse.json({ shares });
}

// Remove a share
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const shareId = searchParams.get("shareId");

  if (!shareId) {
    return NextResponse.json(
      { error: "shareId query parameter required" },
      { status: 400 }
    );
  }

  const share = await prisma.documentShare.findUnique({
    where: { id: shareId },
    include: { document: true }
  });

  if (!share) {
    return NextResponse.json({ error: "Share not found" }, { status: 404 });
  }

  // Only the document owner can remove shares
  if (share.document.ownerId !== authUser.userId) {
    return NextResponse.json(
      { error: "Only the document owner can remove shares" },
      { status: 403 }
    );
  }

  await prisma.documentShare.delete({ where: { id: shareId } });

  return NextResponse.json({ success: true });
}
