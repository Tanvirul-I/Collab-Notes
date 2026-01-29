import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyRequestUser } from "@/lib/auth";

const createVersionSchema = z.object({
  summary: z.string().default(""),
  snapshot: z.string().default("")
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

  if (document.ownerId === userId) {
    return { document, permission: "owner", isOwner: true };
  }

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

  const versions = await prisma.documentVersion.findMany({
    where: { documentId: params.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      summary: true,
      author: { select: { id: true, name: true, email: true } }
    }
  });

  return NextResponse.json({ versions });
}

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const shareToken = request.nextUrl.searchParams.get("shareToken");
  const access = await getDocumentWithAccess(params.id, authUser.userId, shareToken);
  if (!access) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (access.permission === "viewer") {
    return NextResponse.json(
      { error: "You don't have permission to edit this document" },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = createVersionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const summary = parsed.data.summary.slice(0, 100);

  const version = await prisma.documentVersion.create({
    data: {
      documentId: params.id,
      authorId: authUser.userId,
      summary,
      snapshot: parsed.data.snapshot
    }
  });

  console.info("Version saved", {
    documentId: params.id,
    authorId: authUser.userId,
    versionId: version.id
  });

  return NextResponse.json({ version }, { status: 201 });
}
