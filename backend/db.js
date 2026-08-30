const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'memoire.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. Users Table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE,
      displayName TEXT NOT NULL,
      avatar TEXT,
      driveAccessToken TEXT,
      driveRefreshToken TEXT,
      createdAt INTEGER NOT NULL
    )
  `);

  // 2. Lobbies Table
  db.run(`
    CREATE TABLE IF NOT EXISTS lobbies (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      createdBy TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      driveFolderId TEXT,
      driveLink TEXT,
      isPublic INTEGER DEFAULT 0,
      photoCount INTEGER DEFAULT 0,
      lastUpdatedAt INTEGER NOT NULL,
      FOREIGN KEY (createdBy) REFERENCES users(id)
    )
  `);

  // 3. Lobby Members Table
  db.run(`
    CREATE TABLE IF NOT EXISTS lobby_members (
      id TEXT PRIMARY KEY,
      lobbyId TEXT NOT NULL,
      userId TEXT NOT NULL,
      email TEXT,
      displayName TEXT,
      avatar TEXT,
      role TEXT NOT NULL DEFAULT 'editor',
      joinedAt INTEGER NOT NULL,
      FOREIGN KEY (lobbyId) REFERENCES lobbies(id) ON DELETE CASCADE,
      FOREIGN KEY (userId) REFERENCES users(id)
    )
  `);

  // 4. Photos Table
  db.run(`
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      lobbyId TEXT NOT NULL,
      filename TEXT NOT NULL,
      caption TEXT,
      dataUrl TEXT NOT NULL,
      size INTEGER DEFAULT 0,
      uploadedBy TEXT NOT NULL,
      uploaderName TEXT,
      uploaderAvatar TEXT,
      uploadedAt INTEGER NOT NULL,
      driveFileId TEXT,
      isDeleted INTEGER DEFAULT 0,
      FOREIGN KEY (lobbyId) REFERENCES lobbies(id) ON DELETE CASCADE,
      FOREIGN KEY (uploadedBy) REFERENCES users(id)
    )
  `);

  // 5. Invites Table
  db.run(`
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      lobbyId TEXT NOT NULL,
      token TEXT UNIQUE NOT NULL,
      createdBy TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER,
      maxUses INTEGER,
      usedCount INTEGER DEFAULT 0,
      defaultRole TEXT DEFAULT 'editor',
      isRevoked INTEGER DEFAULT 0,
      FOREIGN KEY (lobbyId) REFERENCES lobbies(id) ON DELETE CASCADE
    )
  `);
});

// Helper promise wrappers for clean async/await
const dbAsync = {
  get: (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  }),
  all: (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  }),
  run: (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) return reject(err);
      resolve({ lastID: this.lastID, changes: this.changes });
    });
  })
};

module.exports = { db, dbAsync };
