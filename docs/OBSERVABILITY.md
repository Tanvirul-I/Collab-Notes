# Observability

## Logging

The realtime service logs:

- Client connect/disconnect events.
- Unauthorized access attempts.
- Viewer write attempts.
- Persistence failures.

The API logs:

- Version save and restore events.

## Metrics

The realtime server exposes:

- `activeDocuments`: number of active document rooms.
- `activeConnections`: number of websocket connections.
- `opsPerMinute`: rolling count of Yjs updates in the last 60 seconds.

Example:

```bash
curl http://localhost:4001/metrics
```
