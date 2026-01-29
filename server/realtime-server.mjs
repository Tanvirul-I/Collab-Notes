import "dotenv/config";
import http from "http";
import { WebSocket, WebSocketServer } from "ws";
import { jwtVerify } from "jose";
import Redis from "ioredis";
import * as Y from "yjs";
import { PrismaClient } from "@prisma/client";

const port = Number(process.env.REALTIME_PORT ?? 4001);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const heartbeatIntervalMs = 5000;
const heartbeatTimeoutMs = 10000;
const persistDelayMs = 1000;

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is not set");
}

// Try to connect to Redis, but make it optional
let redis = null;
let redisAvailable = false;
const prisma = new PrismaClient();

const operations = [];

try {
  redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy: () => null, // Don't retry on failure
    lazyConnect: true
  });
  
  redis.on("error", () => {
    if (redisAvailable) {
      console.log("Redis connection lost, falling back to in-memory storage");
    }
    redisAvailable = false;
  });
  
  redis.on("connect", () => {
    redisAvailable = true;
    console.log("Connected to Redis for persistence");
  });
  
  // Try to connect
  redis.connect().catch(() => {
    console.log("Redis not available, using in-memory storage (data won't persist across restarts)");
  });
} catch (error) {
  console.log("Redis not available, using in-memory storage");
}

const rooms = new Map();
const connectionState = new Map();

function encodeUpdate(update) {
  return Buffer.from(update).toString("base64");
}

function decodeUpdate(payload) {
  return new Uint8Array(Buffer.from(payload, "base64"));
}

function getRedisKey(documentId) {
  return `doc:${documentId}:state`;
}

async function verifyToken(token) {
  try {
    const { payload } = await jwtVerify(
      token,
      new TextEncoder().encode(process.env.JWT_SECRET)
    );

    if (!payload?.userId || !payload?.email) {
      return null;
    }

    return {
      userId: payload.userId,
      email: payload.email
    };
  } catch (error) {
    console.error("JWT verification failed", error);
    return null;
  }
}

async function getDocumentAccess(documentId, userId, shareToken) {
  // Validate documentId format to prevent database errors
  if (!documentId || typeof documentId !== "string") {
    return { error: "invalidId" };
  }

  let document;
  try {
    document = await prisma.document.findUnique({
      where: { id: documentId }
    });
  } catch (error) {
    console.error("Error fetching document:", error);
    return { error: "notFound" };
  }

  if (!document) {
    return { error: "notFound" };
  }

  if (document.ownerId === userId) {
    return { permission: "owner" };
  }

  const share = await prisma.documentShare.findUnique({
    where: { documentId_userId: { documentId, userId } }
  });

  if (share) {
    return { permission: share.permission };
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
      return { permission: link.permission };
    }
  }

  return { error: "noAccess" };
}

async function getRoom(documentId) {
  if (rooms.has(documentId)) {
    return rooms.get(documentId);
  }

  const doc = new Y.Doc();
  let restored = false;
  
  // Try to restore from Redis if available
  if (redisAvailable && redis && redis.status === "ready") {
    try {
      const persisted = await redis.get(getRedisKey(documentId));
      if (persisted) {
        Y.applyUpdate(doc, decodeUpdate(persisted));
        restored = true;
        console.info("Restored document from Redis", documentId);
      }
    } catch (error) {
      console.error("Failed to restore from Redis, will try database", error);
    }
  }

  // Fall back to database if Redis didn't have the document
  if (!restored) {
    try {
      const latestVersion = await prisma.documentVersion.findFirst({
        where: { documentId },
        orderBy: { createdAt: "desc" }
      });
      
      if (latestVersion && latestVersion.snapshot) {
        Y.applyUpdate(doc, decodeUpdate(latestVersion.snapshot));
        restored = true;
        console.info("Restored document from database", documentId);
      }
    } catch (error) {
      console.error("Failed to restore from database", error);
    }
  }

  const room = {
    doc,
    connections: new Set(),
    presence: new Map(),
    persistTimeout: null
  };

  rooms.set(documentId, room);
  return room;
}

function recordOperation() {
  const now = Date.now();
  operations.push(now);
  while (operations.length > 0 && now - operations[0] > 60_000) {
    operations.shift();
  }
}

function getOpsPerMinute() {
  const now = Date.now();
  while (operations.length > 0 && now - operations[0] > 60_000) {
    operations.shift();
  }
  return operations.length;
}

// Track last database persist time per document to avoid too frequent writes
const lastDbPersist = new Map();
const dbPersistIntervalMs = 5000; // Don't persist to DB more than every 5 seconds

async function persistRoom(documentId, room) {
  const update = Y.encodeStateAsUpdate(room.doc);
  const snapshot = encodeUpdate(update);
  
  // Try Redis first if available
  if (redisAvailable && redis && redis.status === "ready") {
    try {
      await redis.set(getRedisKey(documentId), snapshot);
      return; // Success with Redis, no need for DB persistence
    } catch (error) {
      if (error.message?.includes("Connection is closed")) {
        redisAvailable = false;
      } else {
        console.error("Failed to persist to Redis, falling back to database", error);
      }
    }
  }
  
  // Fall back to database persistence
  const now = Date.now();
  const lastPersist = lastDbPersist.get(documentId) ?? 0;
  
  // Rate limit database writes
  if (now - lastPersist < dbPersistIntervalMs) {
    return;
  }
  
  try {
    // Get existing latest version to compare
    const latestVersion = await prisma.documentVersion.findFirst({
      where: { documentId },
      orderBy: { createdAt: "desc" }
    });
    
    // Only save if content changed or no version exists
    if (!latestVersion || latestVersion.snapshot !== snapshot) {
      // Get document to find owner for authorId
      const doc = await prisma.document.findUnique({
        where: { id: documentId }
      });
      
      if (doc) {
        await prisma.documentVersion.create({
          data: {
            documentId,
            authorId: doc.ownerId, // Use owner as author for auto-saves
            summary: "Auto-save",
            snapshot
          }
        });
        lastDbPersist.set(documentId, now);
        console.info("Persisted document to database", documentId);
      }
    }
  } catch (error) {
    console.error("Failed to persist to database", error);
  }
}

function schedulePersist(documentId, room) {
  if (room.persistTimeout) {
    return;
  }

  // Use longer delay when persisting to database (no Redis)
  const delay = (redisAvailable && redis?.status === "ready") ? persistDelayMs : dbPersistIntervalMs;

  room.persistTimeout = setTimeout(async () => {
    room.persistTimeout = null;
    try {
      await persistRoom(documentId, room);
    } catch (error) {
      console.error("Failed to persist Yjs state", error);
    }
  }, delay);
}

function broadcast(room, payload, except) {
  const message = JSON.stringify(payload);
  for (const connection of room.connections) {
    if (connection.readyState !== WebSocket.OPEN) {
      continue;
    }

    if (except && connection === except) {
      continue;
    }

    connection.send(message);
  }
}

function broadcastPresence(documentId, room) {
  // Deduplicate by userId, keeping the most recent entry for each user
  const usersByUserId = new Map();
  for (const presence of room.presence.values()) {
    const existing = usersByUserId.get(presence.userId);
    if (!existing || presence.lastHeartbeat > existing.lastHeartbeat) {
      usersByUserId.set(presence.userId, presence);
    }
  }

  broadcast(room, {
    type: "presence_update",
    documentId,
    users: Array.from(usersByUserId.values())
  });
}

function cleanupRoom(documentId, room) {
  const now = Date.now();
  let updated = false;
  for (const [connection, presence] of room.presence.entries()) {
    if (now - presence.lastHeartbeat > heartbeatTimeoutMs) {
      connectionState.delete(connection);
      room.presence.delete(connection);
      room.connections.delete(connection);
      updated = true;
      try {
        connection.terminate();
      } catch (error) {
        console.error("Failed to terminate stale connection", error);
      }
    }
  }

  if (updated) {
    broadcastPresence(documentId, room);
  }

  if (room.connections.size === 0) {
    rooms.delete(documentId);
  }
}

let wss;

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/metrics") {
    const payload = {
      activeDocuments: rooms.size,
      activeConnections: wss ? wss.clients.size : 0,
      opsPerMinute: getOpsPerMinute()
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
    return;
  }

  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404);
  res.end();
});
wss = new WebSocketServer({ server });

wss.on("connection", (connection, request) => {
  connection.on("message", async (data) => {
    let message;
    try {
      message = JSON.parse(data.toString());
    } catch (error) {
      console.error("Invalid message", error);
      return;
    }

    if (!message?.type) {
      return;
    }

    if (message.type === "join_document") {
      const token = message.token ?? null;
      const documentId = message.documentId;
      const shareToken = message.shareToken ?? null;
      if (!token || !documentId) {
        console.warn("Missing token or documentId during join");
        connection.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        connection.close();
        return;
      }

      const auth = await verifyToken(token);
      if (!auth) {
        console.warn("Unauthorized join attempt");
        connection.send(JSON.stringify({ type: "error", message: "Unauthorized" }));
        connection.close();
        return;
      }

      const access = await getDocumentAccess(documentId, auth.userId, shareToken);
      if (access.error) {
        if (access.error === "notFound" || access.error === "invalidId") {
          console.warn("Document not found", { documentId, userId: auth.userId });
          connection.send(JSON.stringify({ type: "error", message: "Document not found" }));
        } else {
          console.warn("Access denied to document", { documentId, userId: auth.userId });
          connection.send(JSON.stringify({ type: "error", message: "Access denied" }));
        }
        connection.close();
        return;
      }

      const room = await getRoom(documentId);

      room.connections.add(connection);

      const name = message.user?.name ?? auth.email;
      const avatarColor = message.user?.avatarColor ?? "#0ea5e9";
      const cursorPosition = message.cursorPosition ?? 0;
      const selectionRange = message.selectionRange ?? { start: 0, end: 0 };

      connectionState.set(connection, {
        documentId,
        userId: auth.userId,
        permission: access.permission
      });
      room.presence.set(connection, {
        userId: auth.userId,
        name,
        avatarColor,
        cursorPosition,
        selectionRange,
        isTyping: false,
        lastHeartbeat: Date.now()
      });

      console.info("Realtime join", {
        documentId,
        userId: auth.userId,
        permission: access.permission
      });

      const fullUpdate = Y.encodeStateAsUpdate(room.doc);
      connection.send(
        JSON.stringify({
          type: "doc_sync",
          documentId,
          update: encodeUpdate(fullUpdate)
        })
      );

      broadcastPresence(documentId, room);
      return;
    }

    const state = connectionState.get(connection);
    if (!state) {
      connection.send(JSON.stringify({ type: "error", message: "Not joined" }));
      return;
    }

    const room = rooms.get(state.documentId);
    if (!room) {
      return;
    }

    if (message.type === "yjs_update") {
      if (!message.update) {
        return;
      }

      if (state.permission === "viewer") {
        console.warn("Viewer attempted update", {
          documentId: state.documentId,
          userId: state.userId
        });
        connection.send(
          JSON.stringify({ type: "error", message: "Read-only access" })
        );
        return;
      }

      try {
        const update = decodeUpdate(message.update);
        Y.applyUpdate(room.doc, update, "remote");
        schedulePersist(state.documentId, room);
        recordOperation();
        broadcast(room, {
          type: "yjs_update",
          documentId: state.documentId,
          update: message.update
        }, connection);
      } catch (error) {
        console.error("Failed to apply update", error);
      }
      return;
    }

    if (message.type === "cursor_update") {
      const presence = room.presence.get(connection);
      if (!presence) {
        return;
      }

      presence.cursorPosition = message.cursorPosition ?? presence.cursorPosition;
      presence.selectionRange = message.selectionRange ?? presence.selectionRange;
      presence.isTyping = message.isTyping ?? presence.isTyping;
      presence.lastHeartbeat = Date.now();
      room.presence.set(connection, presence);
      broadcastPresence(state.documentId, room);
      return;
    }

    if (message.type === "leave_document") {
      room.connections.delete(connection);
      room.presence.delete(connection);
      connectionState.delete(connection);
      broadcastPresence(state.documentId, room);
      console.info("Realtime leave", {
        documentId: state.documentId,
        userId: state.userId
      });
      return;
    }

    if (message.type === "heartbeat") {
      const presence = room.presence.get(connection);
      if (presence) {
        presence.lastHeartbeat = Date.now();
      }
    }
  });

  connection.on("close", () => {
    const state = connectionState.get(connection);
    if (!state) {
      return;
    }

    const room = rooms.get(state.documentId);
    if (!room) {
      connectionState.delete(connection);
      return;
    }

    room.connections.delete(connection);
    room.presence.delete(connection);
    connectionState.delete(connection);
    broadcastPresence(state.documentId, room);
    console.info("Realtime disconnect", {
      documentId: state.documentId,
      userId: state.userId
    });
  });

  connection.on("pong", () => {
    const state = connectionState.get(connection);
    if (!state) {
      return;
    }

    const room = rooms.get(state.documentId);
    if (!room) {
      return;
    }

    const presence = room.presence.get(connection);
    if (presence) {
      presence.lastHeartbeat = Date.now();
    }
  });

  void request;
});

setInterval(() => {
  for (const [documentId, room] of rooms.entries()) {
    cleanupRoom(documentId, room);
  }

  for (const connection of wss.clients) {
    if (connection.readyState === WebSocket.OPEN) {
      connection.ping();
    }
  }
}, heartbeatIntervalMs);

server.listen(port, () => {
  console.log(`Realtime collaboration server listening on ${port}`);
});
