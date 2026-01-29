# Collab Notes

Collab Notes is a real-time collaborative note-taking app built with Next.js, Prisma, and Yjs. It supports multi-user editing, version history, document sharing, and live presence indicators.

## Features

- **Real-time collaboration** - Multiple users can edit the same document simultaneously with Yjs-powered CRDT sync
- **Rich-text editing** - Full formatting toolbar with bold, italic, underline, lists, and headings
- **Version history** - Manual saves, previews, and one-click restore to previous versions
- **Document sharing** - Share via email/username or generate shareable links with viewer/editor permissions
- **Live presence** - See who's currently editing with avatars, cursors, and typing indicators
- **Search** - Full-text search across document titles and content
- **Export** - Download documents as Markdown files

## Screenshots

![Multi-user editing](docs/images/collab-editing.png)
![Version history panel](docs/images/version-history.png)

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, TypeScript
- **Editor**: TipTap + Yjs for collaborative editing
- **Backend**: Next.js API Routes, Prisma ORM
- **Database**: PostgreSQL
- **Realtime**: WebSocket server with Yjs, Redis for persistence
- **Auth**: JWT-based authentication with HTTP-only cookies

---

## Local Development Setup

### Prerequisites

- **Node.js** 18+ (recommended: 20+)
- **PostgreSQL** 14+ (local installation or Docker)
- **Redis** 6+ (optional - app works without it, but realtime state won't persist across restarts)
- **npm** (included with Node.js)

### Step 1: Clone and Install Dependencies

```bash
git clone <repo-url>
cd collab-notes
npm install
```

### Step 2: Set Up PostgreSQL Database

**Option A: Using Docker (Recommended)**

```bash
docker run --name collab-postgres -e POSTGRES_USER=collab_notes -e POSTGRES_PASSWORD=collab_notes -e POSTGRES_DB=collab_notes -p 5432:5432 -d postgres:14
```

**Option B: Using Local PostgreSQL**

```sql
CREATE USER collab_notes WITH PASSWORD 'collab_notes';
CREATE DATABASE collab_notes OWNER collab_notes;
GRANT ALL PRIVILEGES ON DATABASE collab_notes TO collab_notes;
```

### Step 3: Set Up Redis (Optional)

```bash
docker run --name collab-redis -p 6379:6379 -d redis:7
```

> **Note:** Redis is optional. Without Redis, the realtime server uses in-memory storage which doesn't persist across restarts.

### Step 4: Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```env
# PostgreSQL connection string
DATABASE_URL="postgresql://collab_notes:collab_notes@localhost:5432/collab_notes"

# Secret for signing JWT tokens (change in production!)
JWT_SECRET="your-secret-key-change-this"

# Redis connection (optional)
REDIS_URL="redis://localhost:6379"

# Realtime server configuration
REALTIME_PORT="4001"
NEXT_PUBLIC_REALTIME_URL="ws://localhost:4001"
```

### Step 5: Initialize the Database

```bash
# Run database migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

### Step 6: Start the Servers

You need to run **two servers** - the Next.js app and the realtime WebSocket server.

**Terminal 1 - Next.js Development Server:**

```bash
npm run dev
```

**Terminal 2 - Realtime WebSocket Server:**

```bash
npm run realtime:server
```

### Step 7: Open the App

Navigate to **http://localhost:3000** in your browser.

- Create an account at `/signup`
- Log in at `/login`
- Access your documents at `/app/documents`

---

## Docker Compose (Full Stack)

To run the entire stack (Postgres + Redis + Next.js + Realtime Server) with Docker:

```bash
docker compose up --build
```

Then initialize the database:

```bash
npm ci
npx prisma migrate deploy
npx prisma generate
```

---

## npm Scripts

| Script                    | Description                         |
| ------------------------- | ----------------------------------- |
| `npm run dev`             | Start Next.js development server    |
| `npm run build`           | Build for production                |
| `npm start`               | Start production server             |
| `npm run realtime:server` | Start the WebSocket realtime server |
| `npm run lint`            | Run ESLint                          |
| `npm run typecheck`       | Run TypeScript type checking        |
| `npm run prisma:migrate`  | Create and run a new migration      |
| `npm run prisma:generate` | Generate Prisma client              |

---

## API Routes

### Authentication

- `POST /api/auth/signup` - Create new account
- `POST /api/auth/login` - Login and receive JWT cookie

### Documents

- `GET /api/documents` - List user's documents
- `POST /api/documents` - Create new document
- `GET /api/documents/:id` - Get document details
- `PUT /api/documents/:id` - Update document title
- `DELETE /api/documents/:id` - Delete document

### Version History

- `GET /api/documents/:id/versions` - List all versions
- `GET /api/documents/:id/versions/:versionId` - Get specific version
- `POST /api/documents/:id/versions` - Create new version
- `POST /api/documents/:id/restore/:versionId` - Restore to version

### Sharing

- `POST /api/documents/:id/share` - Share with user
- `GET /api/documents/:id/share` - List shares
- `DELETE /api/documents/:id/share?shareId=:id` - Remove share
- `POST /api/documents/:id/share-links` - Create share link
- `GET /api/documents/:id/share-links` - List share links
- `DELETE /api/documents/:id/share-links?linkId=:id` - Revoke link

### Other

- `GET /api/documents/:id/export?format=markdown` - Export document
- `GET /api/search?q=:query` - Search documents
- `GET /api/session` - Get current session

---

## Troubleshooting

### "Permission denied for table User" (PostgreSQL)

Your database user doesn't have proper permissions. Run:

```sql
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO collab_notes;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO collab_notes;
```

### "Document not found" or "Access denied"

- Ensure the document exists and you have permission to access it
- Check that your session hasn't expired (try logging out and back in)
- For shared documents, verify the share link hasn't expired

### Realtime server not connecting

- Ensure the realtime server is running (`npm run realtime:server`)
- Check `NEXT_PUBLIC_REALTIME_URL` matches the server URL
- Verify firewall isn't blocking WebSocket connections on port 4001

### Redis connection errors

Redis is optional. If not running, you'll see warnings but the app will work with in-memory storage.

---

## Documentation

- [Architecture](docs/ARCHITECTURE.md) - System design and data flow
- [Deployment](docs/DEPLOYMENT.md) - Cloud deployment guide
- [Sharing Model](docs/SHARING_MODEL.md) - Permission system details
- [Observability](docs/OBSERVABILITY.md) - Metrics and monitoring

---

## GitHub Actions

The workflow at `.github/workflows/ci.yml` runs on all pushes and pull requests:

- Installs dependencies
- Runs linting
- Runs type checking
- Runs tests
