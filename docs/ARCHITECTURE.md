# Realtime Collaboration Architecture

```mermaid
flowchart LR
  subgraph Client
    UI[Editor UI (Textarea + Cursor Overlay)]
    REST[REST API]
    WS[WebSocket Client]
    YJS[Yjs CRDT Engine]
  end

  subgraph Server
    API[Next.js API Routes]
    WSAPI[Realtime WS Server (ws + Yjs)]
  end

  subgraph Data
    Postgres[(Postgres)]
    Redis[(Redis)]
  end

  UI -->|initial content fetch| REST
  REST --> API
  API --> Postgres

  UI --> YJS
  YJS -->|CRDT updates| WS
  WS --> WSAPI
  WSAPI --> Redis
  WSAPI -->|broadcast updates + presence| WS
```

## CRDT (Yjs) over WebSockets with optimistic concurrency

1. The editor fetches the latest saved document via REST.
2. The client opens a WebSocket connection and joins the room `doc:<documentId>` with its auth token.
3. A local `Y.Doc` is initialized, the text type is bound to the textarea, and local edits are applied immediately.
4. Each local edit emits a Yjs update that is sent over WebSocket to the server.
5. The server applies incoming updates to the room's `Y.Doc`, broadcasts the update to peers, and throttles persistence to Redis.
6. Presence updates (cursor + selection, user metadata) are sent separately to render live cursors and the “Currently editing” list.

## Redis persistence and scaling

- Serialized Yjs state is stored under `doc:<id>:state`.
- On connect, the realtime server loads the document from Redis and applies updates to the in-memory `Y.Doc`.
- Persist writes are throttled to keep Redis write load manageable while ensuring recent state is retained.

## Example collaboration script

`scripts/simulate-collab.mjs` spins up two headless Yjs clients and simulates concurrent edits.

```bash
node scripts/simulate-collab.mjs \
  --doc-id <documentId> \
  --token <auth_token> \
  --ws-url ws://localhost:4001
```

The script prints the final merged text so reviewers can verify convergence.
