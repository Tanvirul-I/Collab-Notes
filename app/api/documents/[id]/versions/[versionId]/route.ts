import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRequestUser } from "@/lib/auth";

async function canAccessDocument(
  documentId: string,
  userId: string,
  shareToken?: string | null
) {
  const document = await prisma.document.findUnique({
    where: { id: documentId }
  });

  if (!document) {
    return false;
  }

  if (document.ownerId === userId) {
    return true;
  }

  const share = await prisma.documentShare.findUnique({
    where: { documentId_userId: { documentId, userId } }
  });

  if (share) {
    return true;
  }

  if (shareToken) {
    const link = await prisma.documentShareLink.findFirst({
      where: {
        documentId,
        token: shareToken,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    });

    return Boolean(link);
  }

  return false;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; versionId: string } }
) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shareToken = request.nextUrl.searchParams.get("shareToken");
  const access = await canAccessDocument(params.id, authUser.userId, shareToken);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const version = await prisma.documentVersion.findFirst({
    where: { id: params.versionId, documentId: params.id },
    include: {
      author: { select: { id: true, name: true, email: true } }
    }
  });

  if (!version) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ version });
}
