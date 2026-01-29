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
    return { document, permission: "owner" as const };
  }

  const share = await prisma.documentShare.findUnique({
    where: { documentId_userId: { documentId, userId } }
  });

  if (share) {
    return { document, permission: share.permission as "editor" | "viewer" };
  }

  if (shareToken) {
    const link = await prisma.documentShareLink.findFirst({
      where: {
        documentId,
        token: shareToken,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }]
      }
    });

    if (link) {
      return { document, permission: link.permission as "editor" | "viewer" };
    }
  }

  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shareToken = request.nextUrl.searchParams.get("shareToken");
  const format = request.nextUrl.searchParams.get("format") ?? "json";
  const access = await getDocumentAccess(params.id, authUser.userId, shareToken);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const latestVersion = await prisma.documentVersion.findFirst({
    where: { documentId: params.id },
    orderBy: { createdAt: "desc" }
  });

  if (!latestVersion) {
    return NextResponse.json({ error: "No versions to export" }, { status: 404 });
  }

  if (format === "markdown") {
    const title = access.document.title ?? "document";
    const safeTitle = title.replace(/[^a-z0-9-_]+/gi, "-").toLowerCase();
    return new NextResponse(latestVersion.snapshot, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${safeTitle || "document"}.md"`
      }
    });
  }

  return NextResponse.json({
    documentId: access.document.id,
    title: access.document.title,
    versionId: latestVersion.id,
    snapshot: latestVersion.snapshot
  });
}
