import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyRequestUser } from "@/lib/auth";

const updateSchema = z.object({
  title: z.string().min(1).optional()
});

type DocumentAccess = {
  document: Awaited<ReturnType<typeof prisma.document.findUnique>>;
  permission: "owner" | "editor" | "viewer";
  isOwner: boolean;
};

async function getDocumentWithAccess(
  documentId: string,
  userId: string,
  shareToken?: string | null
): Promise<DocumentAccess | null> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: {
      owner: { select: { id: true, name: true, email: true } }
    }
  });

  if (!document) {
    return null;
  }

  // Owner has full access
  if (document.ownerId === userId) {
    return { document, permission: "owner", isOwner: true };
  }

  // Check for share
  const share = await prisma.documentShare.findUnique({
    where: {
      documentId_userId: {
        documentId,
        userId
      }
    }
  });

  if (share) {
    return {
      document,
      permission: share.permission as "editor" | "viewer",
      isOwner: false
    };
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
      return {
        document,
        permission: link.permission as "editor" | "viewer",
        isOwner: false
      };
    }
  }

  return null;
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shareToken = request.nextUrl.searchParams.get("shareToken");
  const access = await getDocumentWithAccess(params.id, authUser.userId, shareToken);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    document: access.document,
    permission: access.permission,
    isOwner: access.isOwner
  });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shareToken = request.nextUrl.searchParams.get("shareToken");
  const access = await getDocumentWithAccess(params.id, authUser.userId, shareToken);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only owner and editors can update
  if (access.permission === "viewer") {
    return NextResponse.json(
      { error: "You don't have permission to edit this document" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = updateSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const title = parsed.data.title ?? access.document!.title;

  const document = await prisma.document.update({
    where: { id: access.document!.id },
    data: {
      title
    }
  });

  return NextResponse.json({ document });
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shareToken = request.nextUrl.searchParams.get("shareToken");
  const access = await getDocumentWithAccess(params.id, authUser.userId, shareToken);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Only owner can delete
  if (!access.isOwner) {
    return NextResponse.json(
      { error: "Only the document owner can delete" },
      { status: 403 }
    );
  }

  await prisma.document.delete({ where: { id: access.document!.id } });
  return NextResponse.json({ success: true });
}
