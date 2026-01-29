# Design decisions

## Why CRDT (Yjs) instead of Operational Transform (OT)

I chose CRDTs via Yjs because it provides strong eventual consistency without needing a
centralized OT transform service. CRDTs let each client apply local changes immediately,
merge concurrent edits deterministically, and recover from temporary disconnects without
replaying complex transform logic. This makes multi-user collaboration predictable, keeps
latency low, and simplifies our realtime server to a relay + persistence role.

## How Redis is used for real-time persistence

The realtime server stores the current Yjs document state in Redis using serialized update
payloads. Each room periodically persists the latest Yjs state so reconnecting clients can
bootstrap from Redis instead of rebuilding from scratch. Redis provides fast reads/writes
for active documents, while Postgres (via `DocumentVersion`) stores periodic snapshots for
long-term history, manual saves, and restoration workflows.
