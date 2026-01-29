import { WebSocket } from "ws";
import * as Y from "yjs";

function getArg(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1];
}

const documentId = getArg("--doc-id");
const token = getArg("--token");
const wsUrl = getArg("--ws-url") ?? "ws://localhost:4001";

if (!documentId || !token) {
  console.log("Usage: node scripts/simulate-collab.mjs --doc-id <id> --token <auth_token> --ws-url ws://localhost:4001");
  process.exit(1);
}

function encodeUpdate(update) {
  return Buffer.from(update).toString("base64");
}

function decodeUpdate(payload) {
  return new Uint8Array(Buffer.from(payload, "base64"));
}

function createClient({ name, avatarColor, initialText }) {
  const doc = new Y.Doc();
  const text = doc.getText("content");
  const socket = new WebSocket(wsUrl);

  socket.on("open", () => {
    socket.send(
      JSON.stringify({
        type: "join_document",
        documentId,
        token,
        user: { name, avatarColor },
        content: ""
      })
    );

    if (initialText) {
      doc.transact(() => {
        text.insert(0, initialText);
      });
    }
  });

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "doc_sync" || message.type === "yjs_update") {
      Y.applyUpdate(doc, decodeUpdate(message.update), "remote");
    }
  });

  doc.on("update", (update, origin) => {
    if (origin === "remote") {
      return;
    }

    socket.send(
      JSON.stringify({
        type: "yjs_update",
        documentId,
        update: encodeUpdate(update)
      })
    );
  });

  return { doc, text, socket };
}

const clientA = createClient({
  name: "Sim-A",
  avatarColor: "#4f46e5",
  initialText: "Hello from A. "
});
const clientB = createClient({
  name: "Sim-B",
  avatarColor: "#f97316",
  initialText: "And B adds this. "
});

setTimeout(() => {
  console.log("Client A text:", clientA.text.toString());
  console.log("Client B text:", clientB.text.toString());
  clientA.socket.close();
  clientB.socket.close();
  process.exit(0);
}, 3000);
