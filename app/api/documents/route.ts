import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { verifyRequestUser } from "@/lib/auth";

const createSchema = z.object({
  title: z.string().min(1)
});

export async function GET(request: NextRequest) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get documents owned by the user
  const ownedDocuments = await prisma.document.findMany({
    where: { ownerId: authUser.userId },
    orderBy: { updatedAt: "desc" },
    include: {
      owner: { select: { id: true, name: true, email: true } }
    }
  });

  // Get documents shared with the user
  const sharedDocs = await prisma.documentShare.findMany({
    where: { userId: authUser.userId },
    include: {
      document: {
        include: {
          owner: { select: { id: true, name: true, email: true } }
        }
      }
    },
    orderBy: { document: { updatedAt: "desc" } }
  });

  const owned = ownedDocuments.map((doc) => ({
    ...doc,
    isShared: false,
    isOwner: true,
    permission: "owner" as const
  }));

  const shared = sharedDocs.map((share) => ({
    ...share.document,
    isShared: true,
    isOwner: false,
    permission: share.permission,
    sharedBy: share.document.owner
  }));

  return NextResponse.json({ documents: owned, sharedDocuments: shared });
}

export async function POST(request: NextRequest) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Validate that userId exists in the JWT payload
  if (!authUser.userId) {
    console.error("JWT payload missing userId:", authUser);
    return NextResponse.json({ error: "Invalid authentication token" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const document = await prisma.document.create({
    data: {
      ownerId: authUser.userId,
      title: parsed.data.title
    }
  });

  await prisma.documentVersion.create({
    data: {
      documentId: document.id,
      authorId: authUser.userId,
      summary: "",
      snapshot: ""
    }
  });

  return NextResponse.json({ document }, { status: 201 });
}
