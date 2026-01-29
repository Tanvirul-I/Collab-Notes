# Sharing model

Collab Notes uses role-based access control for document sharing.

## Roles

- **Owner**: Full access. Can edit, share, and delete the document.
- **Editor**: Can read and edit the document, save versions, and restore snapshots.
- **Viewer**: Read-only access. Cannot update content or save versions.

## Sharing methods

### Invite (email or username)

- Owners can invite a collaborator by email address or username.
- The invite creates a `DocumentShare` entry with `viewer` or `editor` permission.

### Shareable links

- Owners can generate a share link with a permission (`viewer` or `editor`).
- Share links can optionally include an expiration date.
- The API returns a link URL that can be shared with collaborators.
  - Example: `/app/documents/:id?shareToken=...`

## Enforcement

- **HTTP**: All document routes validate ownership, share permissions, or share links.
- **WebSocket**: The realtime server validates access before joining `doc:<id>` rooms and blocks content updates from viewers.
