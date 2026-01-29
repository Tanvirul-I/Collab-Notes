import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRequestUser } from "@/lib/auth";

async function getDocumentAccess(
  documentId: string,
  userId: string,
  shareToken?: string | null
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId }
  });

  if (!document) {
    return null;
  }

  if (document.ownerId === userId) {
    return { permission: "owner" as const };
  }

  const share = await prisma.documentShare.findUnique({
    where: { documentId_userId: { documentId, userId } }
  });

  if (!share) {
    if (shareToken) {
      const link = await prisma.documentShareLink.findFirst({
        where: {
          documentId,
          token: shareToken,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
        }
      });

      if (link) {
        return { permission: link.permission as "editor" | "viewer" };
      }
    }

    return null;
  }

  return { permission: share.permission as "editor" | "viewer" };
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; versionId: string } }
) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shareToken = request.nextUrl.searchParams.get("shareToken");
  const access = await getDocumentAccess(params.id, authUser.userId, shareToken);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (access.permission === "viewer") {
    return NextResponse.json(
      { error: "You don't have permission to edit this document" },
      { status: 403 }
    );
  }

  const version = await prisma.documentVersion.findFirst({
    where: { id: params.versionId, documentId: params.id }
  });

  if (!version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Try to persist to Redis (optional - app works without it)
  const { safeRedisSet, getRedisDocumentKey } = await import("@/lib/redis");
  const persisted = await safeRedisSet(getRedisDocumentKey(params.id), version.snapshot);
  if (!persisted) {
    console.info("Redis not available, skipping realtime cache update for document", params.id);
  }

  const restoredVersion = await prisma.documentVersion.create({
    data: {
      documentId: params.id,
      authorId: authUser.userId,
      summary: version.summary,
      snapshot: version.snapshot
    }
  });

  console.info("Version restored", {
    documentId: params.id,
    authorId: authUser.userId,
    versionId: restoredVersion.id
  });

  return NextResponse.json({ version: restoredVersion, snapshot: version.snapshot });
}
