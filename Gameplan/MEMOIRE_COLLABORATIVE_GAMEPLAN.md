# 🎯 Mémoire Collaborative — Complete Gameplan

> **Technology-Agnostic Hybrid Architecture for Cloud-Shared Photo Lobbies**
>
> This document defines the complete feature set, data contracts, API surface, and phased rollout for transforming Mémoire from a personal memory book into a collaborative, multi-user lobby-based photo sharing platform.

---

## 📊 1. System Architecture Overview

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────┐
│ FRONTEND (Vanilla ES6+ / Existing Mémoire)              │
├─────────────────────────────────────────────────────────┤
│ • User Auth (OAuth 2.0 popup)                           │
│ • Lobby Dashboard (Create/Join/Leave)                   │
│ • Upload UI → Auto-Create Drive Folder                  │
│ • Shared Collage Viewer (Real-time updates)             │
│ • Invite/Permissions Management                         │
└────────────────┬────────────────────────────────────────┘
                 │ REST API + WebSocket
                 ▼
┌─────────────────────────────────────────────────────────┐
│ BACKEND (Lightweight Server)                            │
├─────────────────────────────────────────────────────────┤
│ • REST Endpoints (Lobbies, Photos, Users)              │
│ • WebSocket/SSE for Real-Time Sync                     │
│ • OAuth Token Management (Drive API calls)              │
│ • Lobby State & Permissions                             │
│ • Invite Token Generation                               │
└────────────────┬────────────────────────────────────────┘
                 │ OAuth Delegation
                 ▼
         ┌──────────────────┐
         │  Google Drive    │
         │  (Shared Folder) │
         └──────────────────┘
```

### Design Principle: Hybrid Model

- **Frontend**: Vanilla, lightweight, handles UI state and local caching
- **Backend**: Stateless REST API + WebSocket event relay (real-time)
- **Drive**: Single shared folder per lobby (created by server, photos synced bi-directionally)
- **Database**: Persistent metadata (lobbies, members, permissions, invite tokens)

---

## 🗂️ 2. Data Model & Schema

### Core Entities

```typescript
// ─────────────────────────────────────────────────────────
// USER (OAuth Identity)
// ─────────────────────────────────────────────────────────
interface User {
  id: string;                    // UUID or email-hash
  email: string;                 // OAuth email from Google
  displayName: string;           // User's Google profile name
  avatar: string;                // Google profile picture URL
  driveAccessToken: string;      // Encrypted OAuth token (server-side only)
  driveRefreshToken: string;     // For token refresh (server-side only)
  createdAt: number;             // Timestamp
}

// ─────────────────────────────────────────────────────────
// LOBBY (Shared Gallery Session)
// ─────────────────────────────────────────────────────────
interface Lobby {
  id: string;                    // UUID e.g. "lobby_1723640000000_abc123"
  title: string;                 // Human-readable name (e.g. "Summer 2026")
  description?: string;          // Optional tagline
  createdBy: string;             // userId of creator
  createdAt: number;             // Timestamp
  
  // Drive Integration
  driveFolderId: string;         // Google Drive folder ID (created on first upload)
  driveLink: string;             // Shareable public Drive link
  
  // Members & Permissions
  members: LobbyMember[];        // Array of members with roles
  isPublic: boolean;             // If false, invite-only
  
  // Metadata
  photoCount: number;            // Cached count
  lastUpdatedAt: number;         // When photos were last added
  
  // Soft delete
  deletedAt?: number;            // Null = active, set to delete
}

interface LobbyMember {
  userId: string;                // Reference to User.id
  email: string;                 // Snapshot of email (for display)
  role: 'admin' | 'editor' | 'viewer';
  joinedAt: number;              // When user joined
  permissions: {
    canUpload: boolean;
    canEditCaptions: boolean;
    canRemovePhotos: boolean;
    canManageMembers: boolean;   // Invite/remove/role changes
  };
}

// ─────────────────────────────────────────────────────────
// PHOTO (Shared Memory)
// ─────────────────────────────────────────────────────────
interface LobbyPhoto {
  id: string;                    // UUID or Drive fileId
  lobbyId: string;               // Reference to Lobby
  
  // Drive Metadata
  driveFileId: string;           // Google Drive file ID
  driveThumbnailUrl: string;     // Google Drive thumbnail URL
  
  // Photo Metadata
  filename: string;              // Original filename
  caption: string;               // Editable caption
  uploadedBy: string;            // userId who uploaded
  uploadedAt: number;            // Timestamp
  
  // Storage
  dataUrl?: string;              // Base64 if cached locally (optional)
  size: number;                  // File size in bytes
  
  // Moderation & State
  isDeleted: boolean;            // Soft-delete flag
  deletedBy?: string;            // Who deleted it
  deletedAt?: number;            // When deleted
}

// ─────────────────────────────────────────────────────────
// INVITE (Lobby Access Token)
// ─────────────────────────────────────────────────────────
interface LobbyInvite {
  id: string;                    // UUID
  lobbyId: string;               // Reference to Lobby
  token: string;                 // Random 16–32 char code (e.g. "abc123xyz789")
  createdBy: string;             // userId who created invite
  createdAt: number;             // Timestamp
  expiresAt?: number;            // Optional expiration (null = never expires)
  
  maxUses?: number;              // Null = unlimited
  usedCount: number;             // Current usage count
  
  defaultRole: 'editor' | 'viewer';  // Role granted on join
  isRevoked: boolean;            // Disabled flag
}

// ─────────────────────────────────────────────────────────
// ACTIVITY LOG (Audit Trail)
// ─────────────────────────────────────────────────────────
interface ActivityLog {
  id: string;
  lobbyId: string;
  userId: string;
  action: string;                // 'photo_uploaded', 'photo_deleted', 'caption_edited',
                                 // 'member_joined', 'member_removed', 'invite_created'
  targetId?: string;             // photoId, memberId, etc.
  metadata: Record<string, any>; // Extra context
  timestamp: number;
}
```

---

## 🔌 3. API Contract (REST + WebSocket)

### REST Endpoints

#### Authentication
```
POST /auth/signin
  Request: { }
  Response: { redirectUrl: string }  # Google OAuth popup URL
  
POST /auth/callback
  Request: { code: string, state: string }
  Response: { user: User, sessionToken: string }
  
POST /auth/signout
  Request: { sessionToken: string }
  Response: { }
```

#### Lobbies (CRUD)
```
POST /lobbies
  Auth: Required
  Request: { title: string, description?: string, isPublic: boolean }
  Response: { lobby: Lobby, invite: LobbyInvite }
  
GET /lobbies
  Auth: Required
  Response: { lobbies: Lobby[], yourRole: string }
  
GET /lobbies/:lobbyId
  Auth: Required
  Response: { lobby: Lobby, members: LobbyMember[] }
  
PATCH /lobbies/:lobbyId
  Auth: Required (admin only)
  Request: { title?: string, description?: string, isPublic?: boolean }
  Response: { lobby: Lobby }
  
DELETE /lobbies/:lobbyId
  Auth: Required (admin only)
  Response: { }
```

#### Photos (Upload, Edit, Delete)
```
POST /lobbies/:lobbyId/photos/upload
  Auth: Required (canUpload permission)
  Request: FormData { files: File[], auto_caption?: boolean }
  Response: { photos: LobbyPhoto[] }
  
GET /lobbies/:lobbyId/photos
  Auth: Required (viewer+)
  Query: { skip?: number, limit?: number }
  Response: { photos: LobbyPhoto[], total: number }
  
PATCH /lobbies/:lobbyId/photos/:photoId
  Auth: Required (canEditCaptions or own upload)
  Request: { caption?: string }
  Response: { photo: LobbyPhoto }
  
DELETE /lobbies/:lobbyId/photos/:photoId
  Auth: Required (canRemovePhotos or own upload)
  Response: { }
```

#### Members & Permissions
```
GET /lobbies/:lobbyId/members
  Auth: Required
  Response: { members: LobbyMember[] }
  
PATCH /lobbies/:lobbyId/members/:userId
  Auth: Required (admin only)
  Request: { role?: 'admin'|'editor'|'viewer', permissions?: {...} }
  Response: { member: LobbyMember }
  
DELETE /lobbies/:lobbyId/members/:userId
  Auth: Required (admin only)
  Response: { }
```

#### Invites
```
POST /lobbies/:lobbyId/invites
  Auth: Required (admin only)
  Request: { maxUses?: number, expiresAt?: number, defaultRole?: string }
  Response: { invite: LobbyInvite, shareLink: string }
  
GET /lobbies/:lobbyId/invites
  Auth: Required (admin only)
  Response: { invites: LobbyInvite[] }
  
POST /invites/:token/accept
  Auth: Required
  Request: { }
  Response: { lobby: Lobby, user: User }
  
PATCH /lobbies/:lobbyId/invites/:inviteId
  Auth: Required (admin only)
  Request: { isRevoked?: boolean }
  Response: { invite: LobbyInvite }
```

#### Search & Discovery
```
GET /lobbies/search
  Auth: Required
  Query: { q: string, sort?: 'recent'|'popular', limit?: number }
  Response: { lobbies: Lobby[] }
```

### WebSocket Events (Real-Time Sync)

```javascript
// Client → Server
{
  type: 'subscribe',
  lobbyId: string
}

{
  type: 'unsubscribe',
  lobbyId: string
}

// Server → Client (broadcast to lobby members)
{
  type: 'photo_added',
  photo: LobbyPhoto,
  uploadedBy: string,
  timestamp: number
}

{
  type: 'photo_deleted',
  photoId: string,
  deletedBy: string,
  timestamp: number
}

{
  type: 'caption_updated',
  photoId: string,
  caption: string,
  editedBy: string,
  timestamp: number
}

{
  type: 'member_joined',
  member: LobbyMember,
  timestamp: number
}

{
  type: 'member_left',
  userId: string,
  timestamp: number
}

{
  type: 'member_role_changed',
  userId: string,
  newRole: string,
  changedBy: string,
  timestamp: number
}

{
  type: 'lobby_updated',
  lobby: Partial<Lobby>,
  timestamp: number
}
```

---

## 🚀 4. Feature Breakdown

### Feature 1: User Authentication (OAuth 2.0)

**Scope**: Sign in with Google Drive account

**User Flow**:
1. User clicks "Sign In with Google"
2. Browser opens Google OAuth popup
3. User grants `drive.appdata` + `drive.file` (for reading/writing shared folders)
4. Backend receives auth code, exchanges for access + refresh tokens
5. Backend creates/updates User record
6. Frontend stores session token in sessionStorage
7. User navigated to Lobby Dashboard

**Backend Responsibilities**:
- Manage Google OAuth app credentials
- Exchange auth code for tokens
- Encrypt and store refresh tokens (server-side only)
- Issue short-lived session tokens (JWT or opaque)
- Token refresh on expiry (automatic, transparent to frontend)

**Security**:
- Tokens never passed to frontend (API only in Authorization headers)
- HTTPS only
- Refresh tokens encrypted at rest

**Estimated Effort**: 1–2 days (using OAuth library like `passport.js` or `googleapis`)

---

### Feature 2: Lobby Lifecycle (Create, Join, Leave, Delete)

**Scope**: Users create group photo galleries, invite others, manage membership

**Create Lobby**:
1. User enters title + optional description
2. Backend creates Lobby record (createdBy = current user)
3. Backend auto-creates Google Drive folder under shared space
4. Backend generates first invite token (for sharing with friends)
5. Frontend navigates to lobby view

**Join Lobby (via Invite)**:
1. User receives invite link: `https://memoire.app/invite/abc123xyz`
2. User clicks link (unauthenticated)
3. Frontend checks invite validity (GET `/invites/{token}/preview`)
4. If valid, user signs in
5. User clicks "Accept Invite"
6. Backend validates token, adds user to lobby members, increments use count
7. Frontend navigates to shared lobby

**Leave Lobby**:
1. User clicks "Leave Lobby" button
2. Backend removes user from LobbyMember[]
3. If user was last admin, promote next editor or delete lobby
4. Frontend navigates to Lobby Dashboard

**Delete Lobby**:
1. Admin clicks "Delete Lobby"
2. Confirmation dialog (data cannot be recovered)
3. Backend soft-deletes lobby (sets deletedAt)
4. Backend archives Google Drive folder (or moves to trash)
5. All photos marked as deleted

**Estimated Effort**: 3–4 days

---

### Feature 3: Multi-User Photo Upload

**Scope**: Users upload photos to shared lobby, auto-synced to Google Drive

**Upload Flow**:
1. User selects photo files (local file picker or drag-drop)
2. Frontend:
   - Compresses images (existing `compressImage()`)
   - Shows progress bar
3. Frontend POSTs to `/lobbies/{lobbyId}/photos/upload` with FormData
4. Backend:
   - Validates user permission (`canUpload`)
   - Uploads to Google Drive shared folder via Drive API
   - Stores LobbyPhoto record in DB
   - Broadcasts `photo_added` WebSocket event
5. All connected clients receive real-time update, photo appears in collage

**Auto-Caption** (Optional):
- Server can call auto-caption API (existing logic from `app.js`)
- Or frontend does it before upload

**Estimated Effort**: 3–5 days

---

### Feature 4: Shared Google Drive Folder

**Scope**: Each lobby has a corresponding Drive folder (created on first upload)

**Technical Details**:
- **Drive Folder Structure**:
  ```
  Mémoire Shared Galleries/
  └── [Lobby Title] (e.g. "Summer 2026")
      ├── IMG_001.jpg (uploaded by User A)
      ├── PXL_002.jpg (uploaded by User B)
      └── ...
  ```
- **Permissions**: 
  - All lobby members get view/comment/edit rights (based on role)
  - Public lobbies: anyone with link can view
  - Private lobbies: only members
- **Bi-Directional Sync** (Optional, Phase 2):
  - If users upload photos directly to Drive, detect and sync back to Mémoire
  - If photos deleted from Mémoire, soft-delete in Drive

**Estimated Effort**: 2–3 days

---

### Feature 5: Invite System

**Scope**: Generate shareable invite links with role assignment and expiration

**Invite Generation**:
1. Admin clicks "Generate Invite Link"
2. Modal appears: set role (editor/viewer), max uses, expiration date
3. Backend creates LobbyInvite record with random token
4. Frontend displays shareable link (e.g., `https://memoire.app/invite/abc123xyz`)
5. Link can be copy-pasted, shared via email, QR code, etc.

**Invite Acceptance**:
1. Non-member clicks invite link
2. If not signed in, redirected to OAuth flow
3. Frontend validates invite token with GET `/invites/{token}/preview`
4. User clicks "Accept Invite"
5. Backend checks: token valid, not expired, use count < max
6. Backend adds user to LobbyMember[] with default role
7. Increments usedCount
8. Broadcasts `member_joined` event

**Revocation**:
- Admin can revoke invite tokens anytime (set `isRevoked = true`)
- Revoked links become invalid

**Estimated Effort**: 2–3 days

---

### Feature 6: Permissions & Roles

**Scope**: Fine-grained access control (admin, editor, viewer)

**Roles**:
| Role | Upload | Edit Captions | Remove Photos | Invite Members | Change Roles |
|---|---|---|---|---|---|
| **Admin** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Editor** | ✅ | ✅ | Own only | ❌ | ❌ |
| **Viewer** | ❌ | ❌ | ❌ | ❌ | ❌ |

**Admin Responsibilities**:
- Create invites
- Change member roles
- Remove members
- Delete photos
- Delete lobby (soft-delete)

**Estimated Effort**: 2 days

---

### Feature 7: Real-Time Collaboration (WebSocket)

**Scope**: Live updates when photos uploaded, deleted, captions edited

**Technical Details**:
- Backend maintains WebSocket connection pool per lobby
- When any user performs action (upload, edit, delete), server broadcasts to all connected clients in that lobby
- Frontend subscribes to lobby on page load, unsubscribes on leave
- Real-time collage updates without page refresh

**Estimated Effort**: 3–4 days

---

### Feature 8: Shared Collage Viewer

**Scope**: Masonry collage showing all lobby photos (existing Mémoire UI)

**Changes to Frontend**:
- Instead of loading from local IndexedDB, load from `/lobbies/{lobbyId}/photos`
- Display member avatars + names on photos (badge showing who uploaded)
- Real-time WebSocket updates (photos appear/disappear instantly)
- Lightbox shows uploader name, upload date
- Caption editing restricted by permission level

**Estimated Effort**: 2–3 days (mostly reusing existing collage.js)

---

### Feature 9: Activity Log & Audit Trail

**Scope**: Track all actions in a lobby (optional, Phase 2)

**Logged Events**:
- Photo uploaded (by whom, when, filename)
- Photo deleted (by whom, when)
- Caption edited (by whom, what changed)
- Member joined/left (when)
- Role changed (by whom, old → new role)
- Invite created/revoked

**Frontend Display**:
- Optional "Activity" sidebar showing recent actions
- Timestamp + actor name + action description

**Estimated Effort**: 1–2 days

---

## 📅 5. Phased Rollout

### Phase 1: Core Backend & Auth (2–3 weeks)

**Goals**:
- REST API scaffolding
- Google OAuth integration
- User + Lobby CRUD
- Invite token generation
- Basic permissions model

**Deliverables**:
- Backend (Node.js / Python / Go / etc.)
- User table + Lobby table
- Auth endpoints tested
- Invite system working
- Frontend login UI

**Effort**: ~100–150 hours

---

### Phase 2: Photo Upload & Drive Sync (2 weeks)

**Goals**:
- Photo upload pipeline
- Google Drive folder creation
- Drive API integration
- Photo CRUD endpoints
- Frontend upload UI

**Deliverables**:
- Photo upload working
- Photos appear in Google Drive
- Collage viewer showing lobby photos
- Caption editing

**Effort**: ~80–120 hours

---

### Phase 3: Real-Time Collaboration (1–2 weeks)

**Goals**:
- WebSocket server setup
- Real-time event broadcasting
- Frontend WebSocket client
- Live collage updates

**Deliverables**:
- Multi-user real-time sync
- Photos appear instantly for all connected users
- Members see each other online status (optional)

**Effort**: ~60–90 hours

---

### Phase 4: Polish & Optimization (1 week)

**Goals**:
- Performance tuning (pagination, lazy loading)
- Error handling & edge cases
- Mobile UX polish
- Security audit
- Documentation

**Deliverables**:
- Production-ready backend
- Smooth user experience
- Deployed to server

**Effort**: ~40–60 hours

---

### Phase 2+ (Optional Future Phases)

- **Direct Drive Upload**: Sync photos uploaded directly to Drive folder back to Mémoire
- **Activity Timeline**: Detailed audit log of all actions
- **Rich Sharing**: QR codes, email invites, social media
- **Advanced Permissions**: Custom granular controls
- **Photo Moderation**: Flag inappropriate photos
- **Analytics**: Who's most active, popular photos, etc.

---

## 🏭 6. Technology Stack (Unbiased Options)

### Backend Runtime

| Option | Pros | Cons | Startup Time |
|---|---|---|---|
| **Node.js** | Huge ecosystem, easy async, TypeScript support | Newer dev might struggle with callbacks | 2–3 days |
| **Python (FastAPI)** | Clean syntax, data science libs, async built-in | Smaller web ecosystem | 2–3 days |
| **Go** | Ultra-fast, compiled, goroutines | Steeper learning curve | 3–5 days |
| **Rust** | Blazing fast, memory-safe | Slowest feedback loop, steep curve | 5–7 days |

**Recommendation**: **Node.js (Express/Fastify)** or **Python (FastAPI)** for first 2 phases, then optimize if needed.

---

### Database

| Option | Pros | Cons | Setup Time |
|---|---|---|---|
| **PostgreSQL** | ACID guarantees, JSON support, mature | Needs self-hosting or managed service | 1 day |
| **MongoDB** | Flexible schema, JSON-native | No transactions (careful with consistency) | 1 day |
| **Firebase** | Managed, real-time, no ops | Vendor lock-in, limited querying | 2 hours |
| **Supabase** | Postgres + real-time APIs + Auth built-in | Still managed (but open-source) | 4 hours |

**Recommendation**: **PostgreSQL** (self-hosted or RDS) for maximum control, or **Supabase** for rapid prototyping.

---

### WebSocket / Real-Time

| Option | Pros | Cons |
|---|---|---|
| **Socket.io** | Easy, fallbacks, rooms | Extra abstraction layer |
| **Native WebSocket** | Lightweight, built-in | More manual room management |
| **Pusher/Ably** | Fully managed | Vendor lock-in, monthly cost |

**Recommendation**: **Socket.io** (easy, battle-tested) or **native WebSocket** (lightweight).

---

### Deployment

| Option | Pros | Cons | Cost |
|---|---|---|---|
| **Heroku** | One-button deploy, free tier | Slower dyno spins, pricey at scale | $7–25/mo |
| **Railway** | Modern UX, good free tier | Smaller community | $5–20/mo |
| **Fly.io** | Global deployment, cheap | Overkill for start | $5–15/mo |
| **AWS (EC2)** | Full control, cheap at scale | DevOps complexity | $5–50/mo |
| **DigitalOcean** | Simple, affordable | Needs SSH knowledge | $5–20/mo |

**Recommendation**: **Railway** or **DigitalOcean App Platform** for quick launch.

---

## 🔐 7. Security Considerations

### OAuth Token Management
- **Never store access tokens in localStorage** (XSS vulnerability)
- Keep tokens server-side only, issue opaque session tokens to frontend
- Use refresh tokens to auto-renew access without user interaction
- Set short expiration (15–30 min) on access tokens

### Photo Access Control
- Always validate user permission before serving photo
- Don't expose direct Drive URLs (proxy through backend)
- Use rate limiting on photo download endpoints

### Invite Tokens
- Generate cryptographically secure random tokens (16–32 chars)
- One-time use vs unlimited use (configurable per invite)
- Expiration dates (optional)
- Revocation mechanism (set isRevoked flag)

### Database Security
- Use parameterized queries (prevent SQL injection)
- Hash passwords if storing any (shouldn't be needed with OAuth)
- Encrypt sensitive fields (tokens, API keys) at rest
- Use Row-Level Security (RLS) if using Postgres / Supabase

### API Security
- HTTPS only
- CORS configured for your domain only
- Rate limiting (prevent brute force, spam)
- Input validation on all endpoints
- Log suspicious activity (multiple failed auth, bulk deletions, etc.)

---

## 🎨 8. Frontend Architecture Changes

### New Pages/Views

1. **Login Page**
   - "Sign In with Google" button
   - Privacy/terms links

2. **Lobby Dashboard** (replaces current "create/select lobby")
   - List of lobbies user is member of
   - Create new lobby button
   - Search lobbies (if public discovery enabled)
   - Quick stats (# members, # photos)

3. **Lobby View** (replaces current IndexedDB-based collage)
   - Shared masonry collage (like before, but server-sourced)
   - Real-time WebSocket updates
   - Upload button (if permission allows)
   - Members sidebar (avatars, roles)
   - Invite button (if admin)
   - Settings (if admin)

4. **Invite Link Preview**
   - Shows lobby title, # members, photos
   - "Accept Invite" button
   - Auto-redirects to auth if needed

5. **Lobby Settings Modal** (Admin only)
   - Edit title/description
   - View members (with role/remove options)
   - Manage invites (create, revoke, view usage)
   - Delete lobby (with confirmation)

6. **Member Sidebar**
   - List of active members (with avatars)
   - Who uploaded each photo (badge)
   - Online status (optional)

### State Management Changes

**Before** (Local-First):
```javascript
const photos = []; // from IndexedDB
```

**After** (Hybrid):
```javascript
const currentLobby = {
  id: "...",
  title: "...",
  members: [],
  isAdmin: false
};
const lobbyPhotos = []; // from server
```

Add WebSocket event handlers:
```javascript
socket.on('photo_added', (photo) => {
  photos.push(photo);
  renderCollage();
});

socket.on('caption_updated', ({ photoId, caption }) => {
  const photo = photos.find(p => p.id === photoId);
  photo.caption = caption;
  renderCollage();
});
```

### Reuse Existing Components

- ✅ `collage.js` (renderCollage, card variants, lazy loading)
- ✅ `style.css` (design tokens, masonry layout, polaroids)
- ✅ Lightbox viewer (minimal changes)
- ✅ Captions studio (filter by lobby)
- ✅ Auto-caption engine (reuse in backend)
- ⚠️ Drive-sync.js (replace with new OAuth flow)

---

## 📋 9. Development Checklist (Phase 1)

- [ ] Choose backend tech (Node/Python/Go)
- [ ] Choose database (Postgres/MongoDB/Firebase)
- [ ] Set up Google OAuth app (Console)
- [ ] Create project scaffold (backend)
- [ ] Design DB schema
- [ ] Implement auth endpoints (signin, callback, signout)
- [ ] Implement user creation/retrieval
- [ ] Implement lobby CRUD (create, read, list, update, delete)
- [ ] Implement invite token generation/validation
- [ ] Test auth flow end-to-end
- [ ] Design API error response format
- [ ] Write API documentation
- [ ] Create frontend login UI
- [ ] Create frontend lobby dashboard
- [ ] Hook frontend to backend (REST calls)
- [ ] Test invite acceptance flow
- [ ] Deploy backend (staging)
- [ ] Security audit (tokens, CORS, input validation)
- [ ] Load testing (concurrent users)

---

## 📊 10. Resource Estimates (Unbiased)

| Task | Solo Dev | 2 Devs | Effort |
|---|---|---|---|
| Full Phase 1–4 (MVP) | 8–12 weeks | 4–6 weeks | ~400–600 hours |
| Backend only (1–2 phases) | 4–5 weeks | 2–3 weeks | ~200–250 hours |
| Frontend integration only | 2–3 weeks | 1–2 weeks | ~80–120 hours |

**Key Assumption**: Using modern frameworks/libraries (not building from scratch).

---

## 🎯 11. Success Metrics

- [ ] Users can create lobbies and share invites
- [ ] Photos upload and sync to Google Drive
- [ ] Real-time updates (photo appears for all users within 2 seconds)
- [ ] Multiple users can edit captions simultaneously (no conflicts)
- [ ] Permissions enforced (viewers cannot delete)
- [ ] No data loss (soft deletes, activity log)
- [ ] <500ms API response times
- [ ] 99.9% uptime (if deployed to production)

---

## 🚀 Next Steps

1. **Decide on stack**: Node.js? Python? Other?
2. **Decide on database**: Postgres? MongoDB? Managed?
3. **Create backend scaffold**: Hello world API
4. **Test Google OAuth integration**: Get it working locally
5. **Build invite system first**: Smallest feature to validate architecture
6. **Iteratively add features**: Auth → Lobbies → Photos → Real-time

---

**End of Gameplan**
