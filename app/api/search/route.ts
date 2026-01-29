import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyRequestUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const authUser = await verifyRequestUser(request);
  if (!authUser) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (!query) {
    return NextResponse.json({ results: [] });
  }

  const ownedDocuments = await prisma.document.findMany({
    where: {
      ownerId: authUser.userId,
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { versions: { some: { snapshot: { contains: query, mode: "insensitive" } } } }
      ]
    },
    include: {
      owner: { select: { id: true, name: true, email: true } }
    },
    orderBy: { updatedAt: "desc" }
  });

  const sharedDocuments = await prisma.documentShare.findMany({
    where: {
      userId: authUser.userId,
      document: {
        OR: [
          { title: { contains: query, mode: "insensitive" } },
          { versions: { some: { snapshot: { contains: query, mode: "insensitive" } } } }
        ]
      }
    },
    include: {
      document: {
        include: {
          owner: { select: { id: true, name: true, email: true } }
        }
      }
    },
    orderBy: { document: { updatedAt: "desc" } }
  });

  const ownedResults = ownedDocuments.map((doc) => ({
    ...doc,
    isShared: false,
    isOwner: true,
    permission: "owner" as const
  }));

  const sharedResults = sharedDocuments.map((share) => ({
    ...share.document,
    isShared: true,
    isOwner: false,
    permission: share.permission,
    sharedBy: share.document.owner
  }));

  return NextResponse.json({ results: [...ownedResults, ...sharedResults] });
}
