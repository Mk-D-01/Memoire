const express = require('express');
const crypto = require('crypto');
const { dbAsync } = require('./db');

const router = express.Router();
const sessionTokens = new Map(); // token -> user object

// Auth Verification Middleware
const verifyAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization header missing or invalid' });
  }

  const token = authHeader.split(' ')[1];
  const user = sessionTokens.get(token);

  if (!user) {
    return res.status(401).json({ error: 'Session expired or invalid' });
  }

  req.user = user;
  next();
};

// Optional / Soft Auth Middleware (attaches user if present, doesn't reject if missing)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    req.user = sessionTokens.get(token) || null;
  } else {
    req.user = null;
  }
  next();
};

// 0. Public Auth & Client Config Endpoint
router.get('/config', (req, res) => {
  res.json({
    clientId: process.env.GOOGLE_CLIENT_ID || ''
  });
});

// 1. Guest Authentication Endpoint (Instant 1-Click Join for fast dev & testing)
router.post('/guest', async (req, res) => {
  try {
    const { displayName } = req.body;
    const name = displayName && displayName.trim() ? displayName.trim() : `Guest Memory Maker #${Math.floor(1000 + Math.random() * 9000)}`;
    const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const avatar = `https://api.dicebear.com/7.x/bottts/svg?seed=${userId}`;

    const user = {
      id: userId,
      email: `${userId}@guest.memoire.local`,
      displayName: name,
      avatar,
      createdAt: Date.now()
    };

    await dbAsync.run(
      `INSERT INTO users (id, email, displayName, avatar, createdAt) VALUES (?, ?, ?, ?, ?)`,
      [user.id, user.email, user.displayName, user.avatar, user.createdAt]
    );

    const token = `sess_${crypto.randomBytes(16).toString('hex')}`;
    sessionTokens.set(token, user);

    res.json({ token, user });
  } catch (err) {
    console.error('Guest Auth Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 1b. Exchange a Google Identity Services access token for a collaboration session.
router.post('/google', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ error: 'Google access token is required' });
    }

    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!profileResponse.ok) {
      return res.status(401).json({ error: 'Google access token is invalid or expired' });
    }

    const profile = await profileResponse.json();
    const email = String(profile.email || '').trim().toLowerCase();
    if (!email || profile.email_verified === false) {
      return res.status(401).json({ error: 'A verified Google email is required' });
    }

    const existing = await dbAsync.get(`SELECT * FROM users WHERE email = ?`, [email]);
    const user = {
      id: existing?.id || `usr_${crypto.randomBytes(8).toString('hex')}`,
      email,
      displayName: profile.name || email.split('@')[0],
      avatar: profile.picture || null,
      createdAt: existing?.createdAt || Date.now()
    };

    if (existing) {
      await dbAsync.run(`UPDATE users SET displayName = ?, avatar = ? WHERE id = ?`, [user.displayName, user.avatar, user.id]);
    } else {
      await dbAsync.run(
        `INSERT INTO users (id, email, displayName, avatar, createdAt) VALUES (?, ?, ?, ?, ?)`,
        [user.id, user.email, user.displayName, user.avatar, user.createdAt]
      );
    }

    const token = `sess_${crypto.randomBytes(16).toString('hex')}`;
    sessionTokens.set(token, user);
    res.json({ token, user });
  } catch (err) {
    console.error('Google Auth Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Fetch Active Session
router.get('/me', verifyAuth, (req, res) => {
  res.json({ user: req.user });
});

// 3. Logout
router.post('/signout', verifyAuth, (req, res) => {
  const token = req.headers.authorization.split(' ')[1];
  sessionTokens.delete(token);
  res.json({ success: true });
});

module.exports = { router, verifyAuth, optionalAuth, sessionTokens };
