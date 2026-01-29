"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import * as Y from "yjs";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Collaboration from "@tiptap/extension-collaboration";
import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

const cursorPluginKey = new PluginKey("collab-cursors");

type Document = {
  id: string;
  title: string;
  updatedAt: string;
};

type DocumentShare = {
  id: string;
  permission: string;
  user: {
    id: string;
    email: string;
    name: string;
    avatarColor: string;
  };
};

type DocumentVersion = {
  id: string;
  createdAt: string;
  summary: string;
  snapshot?: string;
  author: {
    id: string;
    name: string;
    email: string;
  };
};

type SessionUser = {
  id: string;
  name: string;
  email: string;
  token: string;
};

type PresenceUser = {
  userId: string;
  name: string;
  avatarColor: string;
  cursorPosition: number;
  selectionRange: { start: number; end: number };
  isTyping: boolean;
  lastHeartbeat: number;
};

const cursorColors = [
  "#2563eb",
  "#db2777",
  "#16a34a",
  "#f97316",
  "#7c3aed",
  "#0f766e"
];

const snapshotIntervalMs = 3 * 60 * 1000;
const snapshotOperationThreshold = 200;
const typingDebounceMs = 1200;

function encodeUpdate(update: Uint8Array) {
  let binary = "";
  update.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeUpdate(payload: string) {
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getColorFromId(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash + id.charCodeAt(i) * (i + 1)) % cursorColors.length;
  }
  return cursorColors[hash];
}

function createCursorPlugin() {
  return new Plugin({
    key: cursorPluginKey,
    state: {
      init: () => DecorationSet.empty,
      apply: (transaction, decorations) => {
        const meta = transaction.getMeta(cursorPluginKey);
        if (meta?.decorations) {
          return meta.decorations as DecorationSet;
        }

        if (transaction.docChanged) {
          return decorations.map(transaction.mapping, transaction.doc);
        }

        return decorations;
      }
    },
    props: {
      decorations(state) {
        return this.getState(state);
      }
    }
  });
}

const CursorExtension = Extension.create({
  name: "presenceCursors",
  addProseMirrorPlugins() {
    return [createCursorPlugin()];
  }
});

function buildCursorDecorations(doc: Parameters<typeof DecorationSet.create>[0], users: PresenceUser[]) {
  const decorations: Decoration[] = [];
  const docSize = doc.content.size;

  users.forEach((user) => {
    const cursorPosition = Math.min(Math.max(user.cursorPosition ?? 1, 1), Math.max(docSize, 1));
    const cursor = document.createElement("span");
    cursor.className = "remote-cursor";
    cursor.style.borderColor = user.avatarColor;

    const label = document.createElement("span");
    label.className = "remote-cursor-label";
    label.textContent = user.name;
    label.style.backgroundColor = user.avatarColor;
    cursor.appendChild(label);

    decorations.push(
      Decoration.widget(cursorPosition, cursor, {
        key: user.userId,
        side: 1
      })
    );

    const selectionStart = Math.min(
      Math.max(user.selectionRange?.start ?? cursorPosition, 1),
      Math.max(docSize, 1)
    );
    const selectionEnd = Math.min(
      Math.max(user.selectionRange?.end ?? cursorPosition, 1),
      Math.max(docSize, 1)
    );

    if (selectionEnd > selectionStart) {
      decorations.push(
        Decoration.inline(selectionStart, selectionEnd, {
          class: "remote-selection",
          style: `background-color: ${user.avatarColor}22;`
        })
      );
    }
  });

  return DecorationSet.create(doc, decorations);
}

function formatSummary(summary: string) {
  if (!summary) {
    return "(Empty snapshot)";
  }
  return summary;
}

function formatVersionTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function getInitials(name: string) {
  const parts = name.trim().split(" ");
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function VersionPreview({ snapshot }: { snapshot: string }) {
  const ydoc = useMemo(() => {
    const doc = new Y.Doc();
    if (snapshot) {
      Y.applyUpdate(doc, decodeUpdate(snapshot), "preview");
    }
    return doc;
  }, [snapshot]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false
      }),
      Underline,
      Collaboration.configure({
        document: ydoc,
        field: "content"
      })
    ],
    editable: false,
    immediatelyRender: false
  });

  return <EditorContent editor={editor} className="editor-surface preview" />;
}

export default function DocumentEditor() {
  const params = useParams();
  const router = useRouter();
  const documentId = params?.id as string;

  const [document, setDocument] = useState<Document | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [titleStatus, setTitleStatus] = useState("");
  const [session, setSession] = useState<SessionUser | null>(null);
  const [realtimeStatus, setRealtimeStatus] = useState("Connecting");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [saveStatus, setSaveStatus] = useState("");
  const [versionStatus, setVersionStatus] = useState("");
  const [error, setError] = useState("");
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [permission, setPermission] = useState<"owner" | "editor" | "viewer">("owner");
  const [isOwner, setIsOwner] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);
  const [shares, setShares] = useState<DocumentShare[]>([]);
  const [shareIdentifier, setShareIdentifier] = useState("");
  const [sharePermission, setSharePermission] = useState<"viewer" | "editor">("viewer");
  const [shareError, setShareError] = useState("");
  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [previewVersion, setPreviewVersion] = useState<DocumentVersion | null>(null);

  const searchParams = useSearchParams();
  const shareToken = searchParams.get("shareToken");

  const yDocRef = useRef<Y.Doc | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shouldReconnectRef = useRef(true);
  const cursorUpdateTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const snapshotTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const snapshotInFlight = useRef(false);
  const pendingOperations = useRef(0);
  const lastSnapshotAt = useRef(Date.now());

  const realtimeUrl = useMemo(() => {
    if (typeof window === "undefined") {
      return "";
    }
    const envUrl = process.env.NEXT_PUBLIC_REALTIME_URL;
    if (envUrl) {
      return envUrl;
    }
    return `ws://${window.location.hostname}:4001`;
  }, []);

  const appendShareToken = (url: string) => {
    if (!shareToken) {
      return url;
    }
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}shareToken=${encodeURIComponent(shareToken)}`;
  };

  const ydoc = useMemo(() => new Y.Doc(), [documentId]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        history: false,
        bulletList: { keepMarks: true },
        orderedList: { keepMarks: true }
      }),
      Underline,
      Collaboration.configure({
        document: ydoc,
        field: "content"
      }),
      CursorExtension
    ],
    editorProps: {
      attributes: {
        class: "editor-surface"
      }
    },
    editable: permission !== "viewer",
    immediatelyRender: false
  });

  const activeEditors = useMemo(() => {
    return presence.filter((user) => user.userId !== session?.id);
  }, [presence, session?.id]);

  const typingUsers = useMemo(() => {
    return activeEditors.filter((user) => user.isTyping);
  }, [activeEditors]);

  const avatars = useMemo(() => {
    if (!session) {
      return activeEditors;
    }
    const currentUser = {
      userId: session.id,
      name: session.name,
      avatarColor: getColorFromId(session.id),
      cursorPosition: 0,
      selectionRange: { start: 0, end: 0 },
      isTyping: false,
      lastHeartbeat: Date.now()
    };
    return [currentUser, ...activeEditors];
  }, [activeEditors, session]);

  async function loadDocumentAndSession() {
    const [docResponse, sessionResponse] = await Promise.all([
      fetch(appendShareToken(`/api/documents/${documentId}`), { cache: "no-store" }),
      fetch("/api/session", { cache: "no-store" })
    ]);

    if (!sessionResponse.ok) {
      if (sessionResponse.status === 401) {
        setError("Your session has expired. Please log in again.");
      } else {
        setError("Unable to load session");
      }
      return;
    }

    if (!docResponse.ok) {
      if (docResponse.status === 404) {
        setError("Document not found. It may have been deleted.");
      } else if (docResponse.status === 403) {
        setError("You don't have permission to access this document.");
      } else if (docResponse.status === 401) {
        setError("Your session has expired. Please log in again.");
      } else {
        setError("Unable to load document");
      }
      return;
    }

    const docPayload = await docResponse.json();
    const sessionPayload = await sessionResponse.json();

    setDocument(docPayload.document);
    setTitleDraft(docPayload.document.title ?? "Untitled");
    setPermission(docPayload.permission ?? "owner");
    setIsOwner(docPayload.isOwner ?? true);
    setSession({
      id: sessionPayload.user.id,
      name: sessionPayload.user.name ?? sessionPayload.user.email,
      email: sessionPayload.user.email,
      token: sessionPayload.token
    });

    if (docPayload.isOwner) {
      loadShares();
    }
  }

  useEffect(() => {
    if (documentId) {
      loadDocumentAndSession();
    }
  }, [documentId, shareToken]);

  useEffect(() => {
    yDocRef.current = ydoc;
    return () => {
      ydoc.destroy();
    };
  }, [ydoc]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    editor.setEditable(permission !== "viewer");
  }, [editor, permission]);

  useEffect(() => {
    if (!editor) {
      return;
    }

    const handler = () => {
      const users = presence.filter((user) => user.userId !== session?.id);
      const decorations = buildCursorDecorations(editor.state.doc, users);
      const transaction = editor.state.tr.setMeta(cursorPluginKey, { decorations });
      editor.view.dispatch(transaction);
    };

    handler();
  }, [editor, presence, session?.id]);

  useEffect(() => {
    if (!editor || !session || !documentId) {
      return;
    }

    const sendCursorUpdate = () => {
      if (cursorUpdateTimeout.current) {
        clearTimeout(cursorUpdateTimeout.current);
      }

      cursorUpdateTimeout.current = setTimeout(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== ws.OPEN) {
          return;
        }

        const selection = editor.state.selection;
        ws.send(
          JSON.stringify({
            type: "cursor_update",
            documentId,
            cursorPosition: selection.anchor,
            selectionRange: {
              start: selection.from,
              end: selection.to
            }
          })
        );
      }, 60);
    };

    const handleSelection = () => {
      sendCursorUpdate();
    };

    editor.on("selectionUpdate", handleSelection);

    return () => {
      editor.off("selectionUpdate", handleSelection);
    };
  }, [editor, session, documentId]);

  useEffect(() => {
    if (!editor || !documentId) {
      return;
    }

    const handleUpdate = () => {
      if (typingTimeout.current) {
        clearTimeout(typingTimeout.current);
      }

      setTypingStatus(true);
      typingTimeout.current = setTimeout(() => {
        setTypingStatus(false);
      }, typingDebounceMs);
    };

    editor.on("update", handleUpdate);

    return () => {
      editor.off("update", handleUpdate);
    };
  }, [editor, documentId]);

  useEffect(() => {
    if (!ydoc || !documentId || !session) {
      return;
    }

    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "remote") {
        return;
      }

      pendingOperations.current += 1;

      const ws = wsRef.current;
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify({
            type: "yjs_update",
            documentId,
            update: encodeUpdate(update)
          })
        );
      }

      if (pendingOperations.current >= snapshotOperationThreshold) {
        void createSnapshot("Auto snapshot", true);
      }
    };

    ydoc.on("update", handleUpdate);

    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [ydoc, documentId, session]);

  useEffect(() => {
    if (!document || !session || !realtimeUrl) {
      return;
    }

    shouldReconnectRef.current = true;

    const connect = () => {
      if (!shouldReconnectRef.current) {
        return;
      }

      // Skip if already connected or connecting
      if (wsRef.current && 
          (wsRef.current.readyState === WebSocket.OPEN || 
           wsRef.current.readyState === WebSocket.CONNECTING)) {
        return;
      }

      setRealtimeStatus("Connecting");
      const ws = new WebSocket(realtimeUrl);
      wsRef.current = ws;

      ws.addEventListener("open", () => {
        setRealtimeStatus("Online");
        setReconnectAttempts(0);
        ws.send(
          JSON.stringify({
            type: "join_document",
            documentId,
            token: session.token,
            shareToken,
            user: {
              name: session.name,
              avatarColor: getColorFromId(session.id)
            }
          })
        );
      });

      ws.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string);
        if (message.type === "doc_sync" || message.type === "yjs_update") {
          Y.applyUpdate(ydoc, decodeUpdate(message.update), "remote");
        }

        if (message.type === "presence_update") {
          setPresence(message.users ?? []);
        }

        if (message.type === "error") {
          setError(message.message ?? "Realtime error");
          // Don't reconnect if document not found or access denied
          if (message.message === "Document not found" || message.message === "Access denied") {
            shouldReconnectRef.current = false;
          }
        }

        // This connection was replaced by a newer one, don't reconnect
        if (message.type === "connection_replaced") {
          shouldReconnectRef.current = false;
        }
      });

      ws.addEventListener("close", () => {
        setRealtimeStatus("Offline");
        attemptReconnect();
      });

      ws.addEventListener("error", () => {
        setRealtimeStatus("Offline");
        attemptReconnect();
      });

      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }

      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: "heartbeat", documentId }));
        }
      }, 5000);
    };

    const attemptReconnect = () => {
      if (!shouldReconnectRef.current) {
        return;
      }

      if (reconnectTimeoutRef.current) {
        return;
      }

      setReconnectAttempts((attempts) => {
        const nextAttempt = attempts + 1;
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectTimeoutRef.current = null;
          connect();
        }, Math.min(5000, 500 + nextAttempt * 500));
        return nextAttempt;
      });
    };

    const sendLeaveMessage = () => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ type: "leave_document", documentId }));
        } catch {
          // Ignore send errors during cleanup
        }
      }
    };

    const closeConnection = () => {
      shouldReconnectRef.current = false;
      sendLeaveMessage();
      const ws = wsRef.current;
      if (ws) {
        ws.close();
        wsRef.current = null;
      }
    };

    const handlePageHide = () => {
      sendLeaveMessage();
    };

    // Intercept all link clicks to ensure WebSocket is closed before navigation
    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const anchor = target.closest("a");
      if (anchor && anchor.href && !anchor.href.includes(documentId)) {
        // User is navigating away from this document
        closeConnection();
      }
    };

    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
    window.document.addEventListener("click", handleLinkClick, true);

    connect();

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("beforeunload", handlePageHide);
      window.document.removeEventListener("click", handleLinkClick, true);
      closeConnection();
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [document, session, documentId, realtimeUrl, shareToken, ydoc]);

  useEffect(() => {
    if (snapshotTimer.current) {
      clearInterval(snapshotTimer.current);
    }

    snapshotTimer.current = setInterval(() => {
      const now = Date.now();
      if (now - lastSnapshotAt.current >= snapshotIntervalMs && pendingOperations.current > 0) {
        void createSnapshot("Auto snapshot", true);
      }
    }, snapshotIntervalMs);

    return () => {
      if (snapshotTimer.current) {
        clearInterval(snapshotTimer.current);
      }
    };
  }, []);

  function setTypingStatus(isTyping: boolean) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) {
      return;
    }

    ws.send(
      JSON.stringify({
        type: "cursor_update",
        documentId,
        isTyping
      })
    );
  }

  async function loadShares() {
    const response = await fetch(`/api/documents/${documentId}/share`, { cache: "no-store" });
    if (response.ok) {
      const payload = await response.json();
      setShares(payload.shares ?? []);
    }
  }

  async function loadVersions() {
    const response = await fetch(appendShareToken(`/api/documents/${documentId}/versions`), {
      cache: "no-store"
    });

    if (response.ok) {
      const payload = await response.json();
      setVersions(payload.versions ?? []);
    }
  }

  async function handleShare(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShareError("");

    const response = await fetch(`/api/documents/${documentId}/share`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier: shareIdentifier, permission: sharePermission })
    });

    if (!response.ok) {
      const payload = await response.json();
      setShareError(payload.error ?? "Failed to share");
      return;
    }

    setShareIdentifier("");
    setSharePermission("viewer");
    await loadShares();
  }

  async function handleRemoveShare(shareId: string) {
    const response = await fetch(`/api/documents/${documentId}/share?shareId=${shareId}`,
      {
        method: "DELETE"
      }
    );

    if (response.ok) {
      await loadShares();
    }
  }

  async function handleDelete() {
    const response = await fetch(`/api/documents/${documentId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Delete failed");
      return;
    }

    router.push("/app/documents");
  }

  async function handleTitleSave() {
    if (!document || titleDraft.trim() === "") {
      return;
    }

    setTitleStatus("Saving title...");

    const response = await fetch(appendShareToken(`/api/documents/${documentId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: titleDraft.trim() })
    });

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Could not update title");
      setTitleStatus("");
      return;
    }

    const payload = await response.json();
    setDocument(payload.document);
    setTitleStatus("Title saved");
    setTimeout(() => setTitleStatus(""), 1500);
  }

  async function createSnapshot(label: string, isAuto = false) {
    if (!ydoc || !editor || snapshotInFlight.current) {
      return;
    }

    snapshotInFlight.current = true;
    if (!isAuto) {
      setSaveStatus("Saving version...");
    }

    const update = Y.encodeStateAsUpdate(ydoc);
    const snapshot = encodeUpdate(update);
    const summary = editor.getText().trim().slice(0, 100);

    const response = await fetch(appendShareToken(`/api/documents/${documentId}/versions`), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ snapshot, summary })
    });

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Could not save version");
      if (!isAuto) {
        setSaveStatus("");
      }
      snapshotInFlight.current = false;
      return;
    }

    const payload = await response.json();
    setVersions((prev) => [payload.version, ...prev]);

    pendingOperations.current = 0;
    lastSnapshotAt.current = Date.now();

    if (isAuto) {
      setVersionStatus(label);
      setTimeout(() => setVersionStatus(""), 2000);
    } else {
      setSaveStatus("Version saved");
      setTimeout(() => setSaveStatus(""), 2000);
    }

    snapshotInFlight.current = false;
  }

  async function handlePreviewVersion(versionId: string) {
    const response = await fetch(
      appendShareToken(`/api/documents/${documentId}/versions/${versionId}`)
    );
    if (!response.ok) {
      setError("Unable to load version preview");
      return;
    }

    const payload = await response.json();
    setPreviewVersion(payload.version);
  }

  async function handleRestoreVersion(versionId: string) {
    const response = await fetch(
      appendShareToken(`/api/documents/${documentId}/restore/${versionId}`),
      {
        method: "POST"
      }
    );

    if (!response.ok) {
      const payload = await response.json();
      setError(payload.error ?? "Restore failed");
      return;
    }

    const payload = await response.json();
    if (payload.snapshot && yDocRef.current) {
      const ydoc = yDocRef.current;
      const fragment = ydoc.getXmlFragment("content");
      ydoc.transact(() => {
        fragment.delete(0, fragment.length);
      }, "restore");
      if (payload.snapshot) {
        Y.applyUpdate(ydoc, decodeUpdate(payload.snapshot), "restore");
      }
    }

    await loadVersions();
    setPreviewVersion(null);
  }

  if (!document) {
    return <p>Loading...</p>;
  }

  return (
    <div className="card editor-page">
      <div className="editor-header">
        <div className="editor-title">
          <input
            className="title-input"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={handleTitleSave}
            aria-label="Document title"
            disabled={permission === "viewer"}
          />
          <div className="subtitle">
            <span>Last updated {new Date(document.updatedAt).toLocaleString()}</span>
            {titleStatus ? <span className="title-status">{titleStatus}</span> : null}
          </div>
        </div>
        <div className="editor-meta">
          <div className="connection-indicator">
            <span
              className={`status-dot ${realtimeStatus === "Online" ? "online" : "offline"}`}
            />
            <span>
              {realtimeStatus}
              {reconnectAttempts > 0 ? ` · reconnecting (${reconnectAttempts})` : ""}
            </span>
          </div>
          <div className="presence-avatars">
            {avatars.map((user) => (
              <div
                key={user.userId}
                className="avatar"
                style={{ background: user.avatarColor }}
                title={user.name}
              >
                {getInitials(user.name)}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="editor-actions">
        <p className="editor-status">
          {activeEditors.length > 0
            ? `Editing with ${activeEditors.map((user) => user.name).join(", ")}`
            : "Just you"}
          {typingUsers.length > 0
            ? ` · ${typingUsers.map((user) => user.name).join(", ")} typing...`
            : ""}
        </p>
        <div className="nav-actions">
          {isOwner ? (
            <button
              className="button secondary"
              onClick={() => setShowShareModal(true)}
              type="button"
            >
              Share
            </button>
          ) : (
            <span className="permission-badge">
              {permission === "editor" ? "Can edit" : "View only"}
            </span>
          )}
          {permission !== "viewer" ? (
            <button
              className="button secondary"
              onClick={() => {
                setShowVersions(true);
                void loadVersions();
              }}
              type="button"
            >
              Version history
            </button>
          ) : null}
          {isOwner ? (
            <button className="button secondary" onClick={handleDelete} type="button">
              Delete
            </button>
          ) : null}
          {permission !== "viewer" ? (
            <button className="button" onClick={() => createSnapshot("Version saved")}
              type="button">
              Save version
            </button>
          ) : null}
        </div>
      </div>

      {saveStatus ? <p className="success">{saveStatus}</p> : null}
      {versionStatus ? <p className="success">{versionStatus}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      <div className="editor-toolbar">
        <button
          type="button"
          className={`toolbar-button ${editor?.isActive("bold") ? "active" : ""}`}
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={permission === "viewer"}
        >
          Bold
        </button>
        <button
          type="button"
          className={`toolbar-button ${editor?.isActive("italic") ? "active" : ""}`}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={permission === "viewer"}
        >
          Italic
        </button>
        <button
          type="button"
          className={`toolbar-button ${editor?.isActive("underline") ? "active" : ""}`}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
          disabled={permission === "viewer"}
        >
          Underline
        </button>
        <button
          type="button"
          className={`toolbar-button ${editor?.isActive("heading", { level: 2 }) ? "active" : ""}`}
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          disabled={permission === "viewer"}
        >
          Heading
        </button>
        <button
          type="button"
          className={`toolbar-button ${editor?.isActive("bulletList") ? "active" : ""}`}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          disabled={permission === "viewer"}
        >
          Bullet list
        </button>
      </div>

      <div className="editor-wrapper">
        <EditorContent editor={editor} />
      </div>

      {showShareModal ? (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Share document</h3>
              <button
                className="button secondary"
                onClick={() => setShowShareModal(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <form className="form-grid" onSubmit={handleShare}>
              <div>
                <label htmlFor="shareIdentifier">Email or username</label>
                <input
                  id="shareIdentifier"
                  name="shareIdentifier"
                  type="text"
                  value={shareIdentifier}
                  onChange={(event) => setShareIdentifier(event.target.value)}
                  placeholder="user@example.com or username"
                  required
                />
              </div>
              <div>
                <label htmlFor="sharePermission">Permission</label>
                <select
                  id="sharePermission"
                  name="sharePermission"
                  value={sharePermission}
                  onChange={(event) => setSharePermission(event.target.value as "viewer" | "editor")}
                >
                  <option value="viewer">Viewer (read only)</option>
                  <option value="editor">Editor (can edit)</option>
                </select>
              </div>
              {shareError ? <p className="error">{shareError}</p> : null}
              <button className="button" type="submit">
                Share
              </button>
            </form>

            {shares.length > 0 ? (
              <div className="share-list">
                <h4>Shared with</h4>
                {shares.map((share) => (
                  <div key={share.id} className="share-item">
                    <div>
                      <strong>{share.user.name}</strong>
                      <p>{share.user.email}</p>
                      <p className="permission-label">
                        {share.permission === "editor" ? "Can edit" : "View only"}
                      </p>
                    </div>
                    <button
                      className="button secondary"
                      onClick={() => handleRemoveShare(share.id)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {showVersions ? (
        <div className="modal-overlay" onClick={() => setShowVersions(false)}>
          <div className="modal version-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Version history</h3>
                <p className="modal-subtitle">
                  {versions.length} saved snapshot{versions.length === 1 ? "" : "s"}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => setShowVersions(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="version-list">
              {versions.map((version) => (
                <div key={version.id} className="version-item">
                  <div>
                    <strong>{formatVersionTimestamp(version.createdAt)}</strong>
                    <p>
                      {version.author?.name ?? version.author?.email}
                      {" · "}
                      {formatSummary(version.summary)}
                    </p>
                  </div>
                  <div className="version-actions">
                    <button
                      className="button secondary"
                      onClick={() => handlePreviewVersion(version.id)}
                      type="button"
                    >
                      Preview
                    </button>
                    <button
                      className="button"
                      onClick={() => handleRestoreVersion(version.id)}
                      type="button"
                    >
                      Restore this version
                    </button>
                  </div>
                </div>
              ))}
              {versions.length === 0 ? <p>No versions yet.</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {previewVersion ? (
        <div className="modal-overlay" onClick={() => setPreviewVersion(null)}>
          <div className="modal preview-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3>Version preview</h3>
                <p className="modal-subtitle">
                  {formatVersionTimestamp(previewVersion.createdAt)} ·{" "}
                  {previewVersion.author?.name ?? previewVersion.author?.email}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => setPreviewVersion(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <div className="preview-summary">{formatSummary(previewVersion.summary)}</div>
            <VersionPreview snapshot={previewVersion.snapshot} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
