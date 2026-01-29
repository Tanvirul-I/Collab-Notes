# Deployment Guide

This guide covers deploying Collab Notes to production environments.

## Prerequisites

- Node.js 20+
- PostgreSQL 14+ (local or managed)
- Redis 6+ (optional but recommended for realtime persistence)
- A secure JWT secret for signing sessions

## Environment Variables

| Variable                   | Required | Description                                                                  |
| -------------------------- | -------- | ---------------------------------------------------------------------------- |
| `DATABASE_URL`             | Yes      | PostgreSQL connection string (e.g., `postgresql://user:pass@host:5432/db`)   |
| `JWT_SECRET`               | Yes      | Secret key for signing JWT tokens (use a strong random string in production) |
| `REDIS_URL`                | No       | Redis connection string (e.g., `redis://host:6379`)                          |
| `REALTIME_PORT`            | No       | Port for the realtime WebSocket server (default: `4001`)                     |
| `NEXT_PUBLIC_REALTIME_URL` | Yes      | Public WebSocket URL for browsers (e.g., `wss://realtime.yourdomain.com`)    |

---

## Local Development with Docker

Start PostgreSQL and Redis containers:

```bash
docker compose up -d postgres redis
```

Then install dependencies and run migrations:

```bash
npm ci
npx prisma migrate deploy
npx prisma generate
```

Start both servers:

```bash
# Terminal 1 - Next.js app
npm run dev

# Terminal 2 - Realtime server
npm run realtime:server
```

---

## Production Deployment

### Option 1: Docker Compose (Self-Hosted)

Build and run the full stack:

```bash
docker compose up --build -d
```

Run migrations against the containerized database:

```bash
docker compose exec app npx prisma migrate deploy
```

---

## Security Considerations

1. **JWT_SECRET**: Use a cryptographically secure random string (32+ characters)
2. **HTTPS**: Always use HTTPS in production for the Next.js app
3. **WSS**: Use secure WebSockets (`wss://`) for the realtime server
4. **Database**: Use SSL connections to your database
5. **CORS**: The realtime server accepts connections from any origin; configure firewall rules as needed

---

## Scaling

- **Next.js**: Scales horizontally (Vercel handles this automatically)
- **Realtime Server**: Currently single-instance; for multi-instance, implement Redis pub/sub for message broadcasting
- **Database**: Use connection pooling (PgBouncer) for high traffic
- **Redis**: Use a cluster for high availability
