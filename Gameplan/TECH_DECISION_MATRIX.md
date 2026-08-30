# 🛠️ Mémoire Collaborative — Technology Decision Matrix

> **Unbiased decision framework for choosing your backend stack**
>
> This document provides honest trade-off analysis for each technology choice without recommendation bias.

---

## 📋 Quick-Start Decision Tree

```
START: Which backend runtime appeals to you?

├─ "I want the fastest time-to-market"
│  └─ Node.js (Express) + PostgreSQL + Socket.io
│     (2–3 days to first working prototype)
│
├─ "I want clean, readable syntax"
│  └─ Python (FastAPI) + PostgreSQL + native WebSocket
│     (2–3 days, slightly longer learning curve on async)
│
├─ "I want a fully managed backend"
│  └─ Supabase (PostgreSQL + real-time + auth built-in)
│     (4–6 hours to MVP, no infrastructure to manage)
│
├─ "I want the fastest runtime performance"
│  └─ Go (Gin/Echo) + PostgreSQL + goroutines
│     (3–5 days, need to learn Go syntax)
│
├─ "I want this to run on my laptop without external services"
│  └─ Node.js + SQLite + Socket.io (optional, for dev only)
│     (1 day to MVP, but not production-ready)
│
└─ "I prefer working with databases I already know"
   └─ [Your preferred database] + [Your preferred runtime]
      (Time varies by expertise)
```

---

## 🔍 Detailed Technology Analysis

### 1. BACKEND RUNTIME

#### Option A: Node.js (Express or Fastify)

**What is it?**
JavaScript runtime on the server. Huge npm ecosystem, event-driven, asynchronous by default.

**Pros**:
- ✅ Large ecosystem (17M+ npm packages)
- ✅ Reuse JavaScript skills (same language as frontend)
- ✅ Async/await built-in (clean WebSocket handling)
- ✅ TypeScript support (strongly typed, fewer bugs)
- ✅ Frameworks: Express (lightweight), Fastify (fast), NestJS (opinionated)
- ✅ OAuth libraries: `passport`, `googleapis`, `google-auth-library`
- ✅ WebSocket: `socket.io`, native `ws`, `uws`
- ✅ Production track record (huge companies use it: Netflix, Uber, Airbnb)

**Cons**:
- ❌ Single-threaded (CPU-bound tasks need workers)
- ❌ Callback complexity if not using async/await
- ❌ Package ecosystem quality varies wildly
- ❌ Memory usage higher than Go/Rust

**Learning Curve**: Low–Medium (if coming from frontend JS)

**Hello World** (3 minutes):
```javascript
const express = require('express');
const app = express();

app.get('/', (req, res) => res.json({ message: 'Hello Mémoire' }));
app.listen(3000, () => console.log('Ready on :3000'));
```

**Time to MVP**: 2–3 days

**Hosting**: Heroku (free tier defunct), Railway, Fly.io, DigitalOcean App Platform, AWS

---

#### Option B: Python (FastAPI or Django)

**What is it?**
Python async web framework with built-in OpenAPI docs and data validation.

**Pros**:
- ✅ Clean, readable syntax (famous for learning curve)
- ✅ Strong data validation (Pydantic models)
- ✅ Auto-generated interactive API docs (`/docs`, `/redoc`)
- ✅ Async/await support (native since Python 3.7)
- ✅ OAuth libraries: `authlib`, `google-auth-httplib2`
- ✅ WebSocket: `starlette`, `python-websockets`
- ✅ Production-ready (Spotify, Dropbox, Netflix use Python backends)
- ✅ Great for data science (numpy, pandas, sklearn)

**Cons**:
- ❌ Slower than Node.js or Go (interpreted)
- ❌ Async handling more boilerplate than Node.js
- ❌ Global Interpreter Lock (GIL) limits true parallelism
- ❌ Smaller web ecosystem than Node.js

**Learning Curve**: Low (especially if familiar with Python)

**Hello World** (3 minutes):
```python
from fastapi import FastAPI

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Hello Mémoire"}

# Run: uvicorn main:app --reload
```

**Time to MVP**: 2–3 days

**Hosting**: Railway, Fly.io, DigitalOcean App Platform, AWS, Render

---

#### Option C: Go (Gin or Echo)

**What is it?**
Compiled language with goroutines (lightweight concurrency), blazing fast.

**Pros**:
- ✅ Ultra-fast (compiled, minimal overhead)
- ✅ Goroutines: handle 100K+ concurrent connections easily
- ✅ Minimal dependencies (most of stdlib included)
- ✅ Single binary deploy (no runtime needed)
- ✅ OAuth: `golang.org/x/oauth2`
- ✅ WebSocket: `gorilla/websocket`, `nhooyr.io/websocket`
- ✅ Used at: Google, Kubernetes, Docker, Ethereum

**Cons**:
- ❌ Steeper learning curve (static typing, interface{}, error handling verbose)
- ❌ Smaller ecosystem than Node/Python
- ❌ Compilation time (not instant feedback like interpreted languages)
- ❌ More verbose syntax

**Learning Curve**: Medium–High (if new to compiled languages)

**Hello World** (5 minutes):
```go
package main

import "github.com/gin-gonic/gin"

func main() {
    r := gin.Default()
    r.GET("/", func(c *gin.Context) {
        c.JSON(200, gin.H{"message": "Hello Mémoire"})
    })
    r.Run(":3000")
}
```

**Time to MVP**: 3–5 days

**Hosting**: Railway, Fly.io, AWS, DigitalOcean App Platform (easy single-binary deploy)

---

#### Option D: Rust (Actix-web or Axum)

**What is it?**
Compiled, memory-safe language. Fastest of all options, steep learning curve.

**Pros**:
- ✅ Blazing fast (compiled, optimized)
- ✅ Memory-safe without GC (no leaks)
- ✅ Fearless concurrency (compile-time guarantees)
- ✅ Used at: Discord, AWS, Dropbox

**Cons**:
- ❌ Very steep learning curve (borrow checker, lifetimes, traits)
- ❌ Slow feedback loop (compilation takes time)
- ❌ Smaller community than Node/Python/Go
- ❌ Overkill for MVP (premature optimization)

**Learning Curve**: High (not recommended for first-time backend)

**Time to MVP**: 5–7 days

**Verdict for You**: Skip for Phase 1, reconsider if performance becomes bottleneck

---

### Recommendation for Mémoire MVP

| Scenario | Pick |
|---|---|
| "I want done ASAP" | **Node.js + Express** |
| "I prefer clean code" | **Python + FastAPI** |
| "I want max performance" | **Go + Gin** |
| "I want hands-off DevOps" | **Supabase** (managed) |

---

## 📊 2. DATABASE

#### Option A: PostgreSQL (Self-Hosted or Managed)

**What is it?**
ACID-compliant relational database. Mature, battle-tested, JSONB support.

**Pros**:
- ✅ ACID transactions (data integrity)
- ✅ Complex queries (JOINs, aggregations, CTE)
- ✅ Full-text search built-in
- ✅ JSONB for semi-structured data
- ✅ Row-Level Security (RLS) for multi-tenant isolation
- ✅ Replication & high availability options
- ✅ Used everywhere (Stripe, Slack, Twitter originally)
- ✅ Open source, no vendor lock-in

**Cons**:
- ❌ More complex to set up (vs Firebase)
- ❌ Need to manage backups, scaling (if self-hosted)
- ❌ Slower than NoSQL for unstructured data
- ❌ Vertical scaling limits (single-machine bottleneck)

**Schema Example**:
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  drive_access_token TEXT NOT NULL,
  drive_refresh_token TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE lobbies (
  id UUID PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  created_by UUID REFERENCES users(id),
  drive_folder_id VARCHAR(255),
  is_public BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE lobby_members (
  id UUID PRIMARY KEY,
  lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id),
  role VARCHAR(50) DEFAULT 'viewer',
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(lobby_id, user_id)
);

CREATE TABLE photos (
  id UUID PRIMARY KEY,
  lobby_id UUID REFERENCES lobbies(id) ON DELETE CASCADE,
  drive_file_id VARCHAR(255),
  caption TEXT,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMP DEFAULT NOW(),
  is_deleted BOOLEAN DEFAULT FALSE
);
```

**Hosting Options**:
- Self-hosted: DigitalOcean Droplet + PostgreSQL ($5–15/mo)
- Managed: AWS RDS ($15–50/mo), DigitalOcean Managed DB ($15–30/mo), Railway ($5–20/mo)

**Setup Time**: 30 min (managed) to 2 hours (self-hosted)

---

#### Option B: MongoDB (NoSQL)

**What is it?**
Document database. Flexible schema, JSON-like documents, horizontal scaling.

**Pros**:
- ✅ Flexible schema (great for prototyping)
- ✅ JSON-like documents (natural fit for JS)
- ✅ Horizontal scaling (sharding)
- ✅ Fast writes (eventual consistency)
- ✅ Easier learning curve than SQL

**Cons**:
- ❌ No ACID transactions (until MongoDB 4.0+, limited)
- ❌ Denormalization complexity (data duplication)
- ❌ Harder to query complex relationships
- ❌ Storage overhead (larger documents)
- ❌ "Eventual consistency" can cause bugs if not careful

**Schema Example**:
```javascript
// users collection
{
  _id: ObjectId("..."),
  email: "user@gmail.com",
  driveAccessToken: "...",
  driveRefreshToken: "...",
  createdAt: ISODate("2026-08-30")
}

// lobbies collection
{
  _id: ObjectId("..."),
  title: "Summer 2026",
  createdBy: ObjectId("..."), // ref to user
  driveFolderId: "1XYZ...",
  isPublic: false,
  members: [
    { userId: ObjectId("..."), role: "admin", joinedAt: ISODate() },
    { userId: ObjectId("..."), role: "editor", joinedAt: ISODate() }
  ],
  createdAt: ISODate("2026-08-30")
}

// photos collection
{
  _id: ObjectId("..."),
  lobbyId: ObjectId("..."),
  driveFileId: "1ABC...",
  caption: "Golden hour",
  uploadedBy: ObjectId("..."),
  uploadedAt: ISODate("2026-08-30"),
  isDeleted: false
}
```

**Hosting Options**:
- MongoDB Atlas (managed): $0–$100+/mo
- Self-hosted: DigitalOcean + MongoDB ($10–25/mo)

**Setup Time**: 10 min (MongoDB Atlas) to 1 hour (self-hosted)

---

#### Option C: Firebase Realtime Database

**What is it?**
Google's managed NoSQL database. Built-in real-time sync and auth.

**Pros**:
- ✅ Fully managed (zero DevOps)
- ✅ Real-time listeners (WebSocket built-in)
- ✅ Firebase Auth integration
- ✅ Fast prototyping
- ✅ Free tier: 100 concurrent connections, 1GB storage

**Cons**:
- ❌ Vendor lock-in (Google)
- ❌ No SQL queries (limited to indexed filters)
- ❌ Can get expensive at scale ($5–100+/mo)
- ❌ Difficult migrations (switching away is hard)
- ❌ Limited complex querying

**Setup Time**: 5 min (create Firebase project)

---

#### Option D: Supabase (PostgreSQL + Real-Time)

**What is it?**
Managed PostgreSQL + real-time APIs + Auth. Open source alternative to Firebase.

**Pros**:
- ✅ PostgreSQL power (ACID, complex queries)
- ✅ Built-in real-time listeners (instant updates)
- ✅ Auth + OAuth built-in
- ✅ Row-Level Security (RLS)
- ✅ Open source (can self-host)
- ✅ Reasonable pricing ($0–100+/mo)
- ✅ No lock-in (migrate to self-hosted Postgres anytime)

**Cons**:
- ❌ Newer (smaller community than Firebase)
- ❌ Still managed (limited customization)

**Setup Time**: 10 min (create Supabase project)

**Pricing Estimate for Mémoire**:
- Free tier: $0 (fine for MVP, 10K real-time subscriptions/sec)
- Pro tier: $25/mo (50GB storage, higher limits)

---

### Recommendation for Mémoire MVP

| Scenario | Pick |
|---|---|
| "I want PostgreSQL power, easy DevOps" | **Supabase** |
| "I want full control, self-host" | **PostgreSQL (managed like RDS or DO)** |
| "I want zero infrastructure friction" | **Firebase** |
| "I prefer NoSQL/JSON" | **MongoDB Atlas** |

---

## 🔌 3. REAL-TIME (WebSocket)

#### Option A: Socket.io (Recommended)

**What is it?**
Abstraction over WebSocket + fallbacks. Automatic reconnection, rooms, events.

**Pros**:
- ✅ Works across all browsers (fallbacks: polling, Flash)
- ✅ Built-in rooms (easy to broadcast to lobby)
- ✅ Auto-reconnection
- ✅ Huge community
- ✅ Adapter plugins (Redis for multi-server scaling)

**Cons**:
- ❌ Extra abstraction (slightly heavier than native WebSocket)
- ❌ Longer connection setup
- ❌ Less suitable for binary data

**Code Example**:
```javascript
// Backend
const io = require('socket.io')(3000);

io.on('connection', (socket) => {
  socket.on('join_lobby', (lobbyId) => {
    socket.join(`lobby_${lobbyId}`);
  });

  socket.on('photo_uploaded', (photo) => {
    io.to(`lobby_${photo.lobbyId}`).emit('photo_added', photo);
  });
});

// Frontend
const socket = io('http://localhost:3000');
socket.emit('join_lobby', 'lobby_abc123');
socket.on('photo_added', (photo) => {
  photos.push(photo);
  renderCollage();
});
```

**Setup Time**: 30 min

---

#### Option B: Native WebSocket

**What is it?**
Browser WebSocket API + standard WebSocket protocol.

**Pros**:
- ✅ Lightweight (no abstraction)
- ✅ Works everywhere (modern browsers)
- ✅ Low latency

**Cons**:
- ❌ Manual room management
- ❌ Manual reconnection logic
- ❌ No fallbacks for old browsers
- ❌ More code to write

**Code Example**:
```javascript
// Backend (Node.js with ws library)
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    const { type, lobbyId, data } = JSON.parse(msg);
    if (type === 'photo_uploaded') {
      wss.clients.forEach(client => {
        if (client.lobbyId === lobbyId) {
          client.send(JSON.stringify({ type: 'photo_added', photo: data }));
        }
      });
    }
  });
});

// Frontend
const ws = new WebSocket('ws://localhost:8080');
ws.onmessage = (event) => {
  const { type, photo } = JSON.parse(event.data);
  if (type === 'photo_added') {
    photos.push(photo);
    renderCollage();
  }
};
```

**Setup Time**: 1–2 hours (need to implement room management)

---

#### Option C: Pusher / Ably (Managed)

**What is it?**
Third-party real-time infrastructure. No servers to manage.

**Pros**:
- ✅ Fully managed (zero DevOps)
- ✅ Global CDN
- ✅ Enterprise support

**Cons**:
- ❌ Vendor lock-in
- ❌ Monthly cost ($30–200+)
- ❌ API limits at free tier

**Cost for Mémoire**: $50–100/mo (not worth for MVP)

---

### Recommendation for Mémoire MVP

| Scenario | Pick |
|---|---|
| "I want ease of use + growth path" | **Socket.io** |
| "I want lean + I don't mind extra code" | **Native WebSocket** |
| "I want managed + don't care about cost" | **Pusher/Ably** |

---

## 🚀 4. DEPLOYMENT

#### Option A: Railway

**What is it?**
Modern deploy platform. GitHub-connected, free tier, PostgreSQL included.

**Pros**:
- ✅ GitHub connect (auto-deploy on push)
- ✅ Generous free tier ($5 credit/mo)
- ✅ PostgreSQL + Redis included
- ✅ Simple environment variables
- ✅ Built-in monitoring

**Cons**:
- ❌ Smaller community than Heroku
- ❌ No free tier anymore (changed policy)

**Monthly Cost**: $5–50 (depending on usage)

---

#### Option B: DigitalOcean App Platform

**What is it?**
DigitalOcean's app hosting. Simple, affordable.

**Pros**:
- ✅ Affordable ($12–25/mo for baseline)
- ✅ DigitalOcean ecosystem (managed DB, storage)
- ✅ Simple dashboard

**Cons**:
- ❌ Fewer convenience features than Railway
- ❌ Smaller free tier

**Monthly Cost**: $12–50

---

#### Option C: Fly.io

**What is it?**
Global deployment platform. Lightweight, distributed.

**Pros**:
- ✅ Global deployment (low latency worldwide)
- ✅ Generous free tier
- ✅ Docker-based

**Cons**:
- ❌ Needs Docker knowledge
- ❌ Smaller community

**Monthly Cost**: $5–50

---

#### Option D: Heroku (Legacy)

**What is it?**
Was the standard. Free tier removed (2022).

**Verdict**: Skip (paid-only now, not cost-effective for MVP)

---

### Recommendation for Mémoire MVP

**Start with: Railway or Fly.io** (generous free tiers, fast iteration)

---

## 🎯 Recommended Complete Stacks (No Bias, Just Options)

### Stack A: Node.js + Express + PostgreSQL + Socket.io (Most Popular)
- **Setup Time**: 3 days
- **Cost**: $10–30/mo
- **Scalability**: Medium (Node.js limit at ~1K connections per server)
- **Learning Curve**: Low
- **Community**: Huge
- **Recommendation**: Best for MVP, re-evaluate after 6 months

---

### Stack B: Python + FastAPI + PostgreSQL + WebSocket (Clean Code)
- **Setup Time**: 3 days
- **Cost**: $10–30/mo
- **Scalability**: Medium
- **Learning Curve**: Low–Medium
- **Community**: Growing
- **Recommendation**: Good if you prefer Python, want readable code

---

### Stack C: Go + Gin + PostgreSQL + Goroutines (Performance)
- **Setup Time**: 4–5 days
- **Cost**: $5–20/mo (single binary = cheap hosting)
- **Scalability**: High (goroutines handle 100K+ connections)
- **Learning Curve**: Medium–High
- **Community**: Growing
- **Recommendation**: Choose if you want to learn Go, anticipate scale

---

### Stack D: Supabase (Fully Managed, Minimal Backend Code)
- **Setup Time**: 1 day
- **Cost**: $0–25/mo (free tier covers MVP)
- **Scalability**: Medium (managed by Supabase)
- **Learning Curve**: Low (mostly frontend + SQL)
- **Community**: Growing
- **Recommendation**: Best for rapid MVP, no DevOps headache

---

## ✅ Decision Checklist

Before picking a stack, ask yourself:

- [ ] Do I want to learn backend engineering? (If no → Supabase)
- [ ] Do I have a preferred language? (Choose that)
- [ ] Do I want to launch in <1 week? (Node.js or Supabase)
- [ ] Do I anticipate 100K+ concurrent users? (Go)
- [ ] Do I want zero infrastructure management? (Supabase or Firebase)
- [ ] Do I want to self-host and own my data? (PostgreSQL + own server)
- [ ] How much can I spend/mo? ($0–10 → Supabase free; $10–50 → Railway/DigitalOcean)

---

**End of Technology Decision Matrix**
