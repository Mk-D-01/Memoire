# 🚀 Mémoire Collaborative — Quick Start Implementation Guide

> **From decision to first API call in 48 hours**
>
> This guide gives you step-by-step instructions to get your backend scaffolded, API mocked, and frontend hooked up.

---

## 📋 Part 1: Pre-Implementation Checklist (30 min)

### Step 1: Choose Your Stack

Use the Technology Decision Matrix to pick:
- [ ] Backend Runtime (Node/Python/Go)
- [ ] Database (PostgreSQL/MongoDB/Supabase)
- [ ] Real-Time (Socket.io/WebSocket)
- [ ] Hosting (Railway/Fly.io/DigitalOcean)

**Recommendation for fastest start**: Node.js + PostgreSQL + Socket.io + Railway

---

### Step 2: Create Google OAuth App

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project: `Memoire Collaborative`
3. Enable APIs:
   - Google Drive API
   - Google+ API
4. Create OAuth 2.0 credential (Web Application):
   - Authorized JavaScript origins: `http://localhost:3000`, `http://localhost:3001`, `https://yourdomain.com`
   - Authorized redirect URIs: `http://localhost:3000/auth/callback`, `https://yourdomain.com/auth/callback`
5. Copy Client ID and Client Secret (store safely!)

---

### Step 3: Set Up Development Environment

```bash
# Create project directory
mkdir memoire-collaborative
cd memoire-collaborative

# Initialize git
git init
git remote add origin https://github.com/yourusername/memoire-collaborative.git

# Create folder structure
mkdir backend frontend
cp -r ~/path/to/existing/memoire/* frontend/

# Initialize backend (Node.js example)
cd backend
npm init -y
npm install express cors dotenv googleapis google-auth-library socket.io pg
```

---

## 🔨 Part 2: Backend Setup (Node.js + Express)

### Step 1: Basic Server Scaffold

**`backend/server.js`**:
```javascript
const express = require('express');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'Backend running ✓' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
```

**`backend/.env`**:
```
PORT=3001
NODE_ENV=development
GOOGLE_CLIENT_ID=<your-client-id>
GOOGLE_CLIENT_SECRET=<your-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:3001/auth/callback
DATABASE_URL=postgresql://user:password@localhost:5432/memoire_dev
JWT_SECRET=<random-secret-key>
```

**Run it**:
```bash
node server.js
# Should print: 🚀 Server running on port 3001
```

---

### Step 2: Mock Database (In-Memory for Fast Prototyping)

**`backend/db.js`** (temporary, replace with PostgreSQL later):
```javascript
// In-memory store (Phase 1 only, replace with real DB in Phase 2)
const store = {
  users: {},
  lobbies: {},
  lobbyMembers: {},
  photos: {},
  invites: {}
};

module.exports = store;
```

---

### Step 3: Auth Endpoints (OAuth Flow)

**`backend/auth.js`**:
```javascript
const express = require('express');
const { google } = require('googleapis');
require('dotenv').config();

const router = express.Router();
let sessionTokens = {}; // Temporary: replace with JWT + DB

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);

// Step 1: Generate OAuth URL (frontend -> backend)
router.post('/signin', (req, res) => {
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ]
  });

  res.json({ redirectUrl: authUrl });
});

// Step 2: OAuth Callback (after user grants permission)
router.get('/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'No auth code' });

  try {
    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user info
    const oauth2 = google.oauth2({ version: 'v1', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    // Mock user creation (replace with DB insert)
    const user = {
      id: userInfo.data.id,
      email: userInfo.data.email,
      displayName: userInfo.data.name,
      avatar: userInfo.data.picture,
      driveAccessToken: tokens.access_token,
      driveRefreshToken: tokens.refresh_token
    };

    // Issue session token
    const sessionToken = 'mock_session_' + Date.now();
    sessionTokens[sessionToken] = user;

    // Redirect to frontend with token
    res.redirect(`http://localhost:3000/?sessionToken=${sessionToken}`);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Step 3: Sign out
router.post('/signout', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) delete sessionTokens[token];
  res.json({ message: 'Signed out' });
});

module.exports = router;
```

**Register auth routes in `server.js`**:
```javascript
const authRoutes = require('./auth');
app.use('/auth', authRoutes);
```

---

### Step 4: Mock Lobby Endpoints

**`backend/lobbies.js`**:
```javascript
const express = require('express');
const db = require('./db');
const router = express.Router();

// Middleware: verify session
const verifyAuth = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  req.user = { id: 'user_' + Math.random(), email: 'user@example.com' };
  next();
};

// Create lobby
router.post('/', verifyAuth, (req, res) => {
  const { title, description, isPublic } = req.body;
  const lobbyId = 'lobby_' + Date.now();
  
  const lobby = {
    id: lobbyId,
    title,
    description,
    isPublic,
    createdBy: req.user.id,
    createdAt: Date.now(),
    driveFolderId: null,
    photoCount: 0,
    members: [{ userId: req.user.id, role: 'admin', joinedAt: Date.now() }]
  };

  db.lobbies[lobbyId] = lobby;

  res.status(201).json({
    lobby,
    invite: {
      id: 'invite_' + Date.now(),
      token: 'invite_token_' + Math.random().toString(36).substr(2, 8),
      defaultRole: 'editor'
    }
  });
});

// List lobbies
router.get('/', verifyAuth, (req, res) => {
  const lobbies = Object.values(db.lobbies).filter(l =>
    l.members.some(m => m.userId === req.user.id)
  );
  res.json({ lobbies });
});

// Get lobby details
router.get('/:lobbyId', verifyAuth, (req, res) => {
  const lobby = db.lobbies[req.params.lobbyId];
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  res.json({ lobby, members: lobby.members });
});

module.exports = router;
```

**Register in `server.js`**:
```javascript
const lobbiesRoutes = require('./lobbies');
app.use('/lobbies', lobbiesRoutes);
```

---

### Step 5: Mock Photo Upload

**`backend/photos.js`**:
```javascript
const express = require('express');
const db = require('./db');
const router = express.Router();

// Verify auth + permission
const verifyPermission = (req, res, next) => {
  req.user = { id: 'user_mock' };
  next();
};

// Upload photos
router.post('/:lobbyId/photos/upload', verifyPermission, (req, res) => {
  const { lobbyId } = req.params;
  const files = req.files || []; // In production: parse FormData

  if (!db.lobbies[lobbyId]) {
    return res.status(404).json({ error: 'Lobby not found' });
  }

  const photos = files.map((file, i) => ({
    id: 'photo_' + Date.now() + '_' + i,
    lobbyId,
    filename: file.originalname,
    caption: 'Auto-caption from filename',
    uploadedBy: req.user.id,
    uploadedAt: Date.now(),
    driveFileId: 'drive_' + Math.random(),
    isDeleted: false
  }));

  photos.forEach(p => db.photos[p.id] = p);
  db.lobbies[lobbyId].photoCount += photos.length;

  res.status(201).json({ photos });
});

// Get lobby photos
router.get('/:lobbyId/photos', (req, res) => {
  const { lobbyId } = req.params;
  const photos = Object.values(db.photos).filter(
    p => p.lobbyId === lobbyId && !p.isDeleted
  );
  res.json({ photos, total: photos.length });
});

module.exports = router;
```

---

### Step 6: Test Your Endpoints

```bash
# Test health check
curl http://localhost:3001/health

# Test sign in (get OAuth URL)
curl -X POST http://localhost:3001/auth/signin

# Test create lobby (use mock token)
curl -X POST http://localhost:3001/lobbies \
  -H "Authorization: Bearer mock_token" \
  -H "Content-Type: application/json" \
  -d '{"title": "Summer 2026", "isPublic": false}'

# Expected: Lobby object + invite token
```

---

## 🔗 Part 3: Connect Frontend to Backend

### Step 1: Update Frontend OAuth

**`frontend/app.js` (modifications)**:
```javascript
// Replace old drive-sync.js logic with:

class BackendSync {
  constructor() {
    this.sessionToken = null;
    this.apiUrl = 'http://localhost:3001';
  }

  async signIn() {
    try {
      const res = await fetch(`${this.apiUrl}/auth/signin`, {
        method: 'POST'
      });
      const { redirectUrl } = await res.json();
      window.location.href = redirectUrl; // Opens Google OAuth
    } catch (err) {
      console.error('Sign in failed', err);
    }
  }

  // After OAuth callback, backend redirects here with ?sessionToken=...
  async onOAuthCallback() {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('sessionToken');
    if (token) {
      sessionStorage.setItem('sessionToken', token);
      window.history.replaceState({}, document.title, '/');
      this.sessionToken = token;
      return true;
    }
    return false;
  }

  getAuthHeader() {
    const token = sessionStorage.getItem('sessionToken');
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async createLobby(title, description) {
    const res = await fetch(`${this.apiUrl}/lobbies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeader()
      },
      body: JSON.stringify({ title, description, isPublic: false })
    });
    return res.json();
  }

  async listLobbies() {
    const res = await fetch(`${this.apiUrl}/lobbies`, {
      headers: this.getAuthHeader()
    });
    return res.json();
  }

  async uploadPhotos(lobbyId, files) {
    const formData = new FormData();
    files.forEach(f => formData.append('files', f));

    const res = await fetch(`${this.apiUrl}/lobbies/${lobbyId}/photos/upload`, {
      method: 'POST',
      headers: this.getAuthHeader(),
      body: formData
    });
    return res.json();
  }
}

const backend = new BackendSync();

// On page load
document.addEventListener('DOMContentLoaded', async () => {
  if (await backend.onOAuthCallback()) {
    console.log('✓ OAuth callback processed');
  }
});
```

### Step 2: Add Lobby Dashboard UI

**Add to `frontend/index.html`** (after header):
```html
<!-- Lobby Dashboard View -->
<section class="lobby-dashboard" id="lobbyDashboard">
  <div class="dashboard-header">
    <h1>Your Lobbies</h1>
    <button class="btn btn-primary" id="btnCreateLobby">+ New Lobby</button>
  </div>
  
  <div class="lobbies-grid" id="lobbiesGrid">
    <!-- Dynamically populated -->
  </div>
</section>

<!-- Create Lobby Modal -->
<div class="modal" id="createLobbyModal">
  <div class="modal-box">
    <h2>Create New Lobby</h2>
    <input type="text" id="lobbyTitle" placeholder="Lobby title (e.g. Summer 2026)" />
    <textarea id="lobbyDesc" placeholder="Description (optional)"></textarea>
    <button id="btnConfirmCreate">Create</button>
  </div>
</div>
```

### Step 3: Add Dashboard Logic

**`frontend/app.js` (add)**:
```javascript
// Render lobby dashboard
async function renderLobbyDashboard() {
  const { lobbies } = await backend.listLobbies();
  
  const html = lobbies.map(lobby => `
    <div class="lobby-card" data-id="${lobby.id}">
      <h3>${lobby.title}</h3>
      <p>${lobby.photoCount} photos · ${lobby.members.length} members</p>
      <button onclick="viewLobby('${lobby.id}')">Open</button>
    </div>
  `).join('');
  
  document.getElementById('lobbiesGrid').innerHTML = html;
}

// View specific lobby
async function viewLobby(lobbyId) {
  currentLobby = lobbyId;
  const { lobby, members } = await backend.getLobby(lobbyId);
  const { photos } = await backend.getPhotos(lobbyId);
  renderCollage(photos, document.getElementById('collageGrid'));
}

// Create lobby
document.getElementById('btnCreateLobby').addEventListener('click', () => {
  // Show modal...
});

document.getElementById('btnConfirmCreate').addEventListener('click', async () => {
  const title = document.getElementById('lobbyTitle').value;
  const description = document.getElementById('lobbyDesc').value;
  await backend.createLobby(title, description);
  renderLobbyDashboard();
});
```

---

## 🔒 Part 4: Security Checklist

Before launching, verify:

- [ ] **OAuth Tokens**: Never stored in localStorage, only sessionStorage (server-managed)
- [ ] **CORS**: Backend only accepts requests from your domain
- [ ] **Input Validation**: All API inputs validated (title length, file size, etc.)
- [ ] **Rate Limiting**: `/auth/callback` rate-limited (prevent brute force)
- [ ] **HTTPS**: All production traffic encrypted
- [ ] **Permissions**: Every API call validates user permission for resource
- [ ] **Error Messages**: Don't leak sensitive info (database errors, file paths)
- [ ] **Secrets**: GOOGLE_CLIENT_SECRET never in frontend code
- [ ] **Password Reset**: Not applicable (OAuth), but test token expiry
- [ ] **Audit Log**: All actions logged (for future debugging)

---

## 🚀 Part 5: Deployment Checklist (Phase 4)

### Pre-Deploy

- [ ] Replace mock in-memory DB with PostgreSQL
- [ ] Replace mock auth tokens with JWT or opaque session tokens
- [ ] Set up environment variables on hosting platform
- [ ] Buy or setup domain (e.g., memoire.app)
- [ ] Update Google OAuth redirect URIs (production domain)
- [ ] Test full flow in staging

### Deploy Backend to Railway (Example)

```bash
# 1. Create Railway account, connect GitHub
# 2. Create new project, select your backend repo
# 3. Add PostgreSQL service (Railway adds DATABASE_URL automatically)
# 4. Set environment variables:
#    - GOOGLE_CLIENT_ID
#    - GOOGLE_CLIENT_SECRET
#    - JWT_SECRET
# 5. Deploy automatically on git push
```

### Deploy Frontend

```bash
# Build for production
cd frontend
npm run build  # or equivalent

# Deploy to Vercel, Netlify, or same Railway
# Update API_URL to production backend
```

---

## 📝 Part 6: Development Roadmap (48 Hours to MVP)

### Day 1 (24 hours)
- [ ] Scaffold backend (Node.js + Express)
- [ ] Mock database + auth endpoints
- [ ] Google OAuth integration
- [ ] Mock lobby CRUD endpoints
- [ ] Backend running locally

### Day 2 (24 hours)
- [ ] Connect frontend to backend API
- [ ] Build lobby dashboard UI
- [ ] Hook up create lobby flow
- [ ] Hook up photo upload endpoint
- [ ] Test end-to-end flow locally

### After MVP (Phase 2+)
- [ ] Real PostgreSQL database
- [ ] Real Drive API integration (folder creation, photo upload)
- [ ] WebSocket real-time sync
- [ ] Invite system
- [ ] Permissions & roles
- [ ] Deploy to production

---

## 🆘 Common Errors & Fixes

| Error | Cause | Fix |
|---|---|---|
| `CORS error` | Frontend domain not whitelisted | Add to `cors({ origin: 'http://localhost:3000' })` |
| `OAuth redirect mismatch` | Frontend redirect URL doesn't match Google | Update Google OAuth app settings |
| `sessionToken undefined` | OAuth callback not firing | Check Google OAuth `redirectUrl` in browser console |
| `"Cannot read property 'id' of undefined"` | Backend user not extracted from token | Add `verifyAuth` middleware to routes |

---

**Next Step**: Pick a tech stack and start with `npm init` or `python -m venv`. Message when you hit first blocker!
