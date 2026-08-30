const express = require('express');
const crypto = require('crypto');
const { dbAsync } = require('./db');
const { verifyAuth } = require('./auth');

const router = express.Router();

// 1. Create a New Lobby
router.post('/', verifyAuth, async (req, res) => {
  try {
    const { title, description, isPublic } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ error: 'Lobby title is required' });
    }

    const lobbyId = `lobby_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const now = Date.now();
    const publicFlag = isPublic ? 1 : 0;

    // Create Lobby
    await dbAsync.run(
      `INSERT INTO lobbies (id, title, description, createdBy, createdAt, isPublic, photoCount, lastUpdatedAt) 
       VALUES (?, ?, ?, ?, ?, ?, 0, ?)`,
      [lobbyId, title.trim(), description || '', req.user.id, now, publicFlag, now]
    );

    // Add Creator as Admin Member
    const memberId = `mem_${crypto.randomBytes(8).toString('hex')}`;
    await dbAsync.run(
      `INSERT INTO lobby_members (id, lobbyId, userId, email, displayName, avatar, role, joinedAt)
       VALUES (?, ?, ?, ?, ?, ?, 'admin', ?)`,
      [memberId, lobbyId, req.user.id, req.user.email, req.user.displayName, req.user.avatar, now]
    );

    // Generate Default Shareable Invite Token
    const inviteId = `inv_${crypto.randomBytes(8).toString('hex')}`;
    const inviteToken = crypto.randomBytes(8).toString('hex');
    await dbAsync.run(
      `INSERT INTO invites (id, lobbyId, token, createdBy, createdAt, defaultRole)
       VALUES (?, ?, ?, ?, ?, 'editor')`,
      [inviteId, lobbyId, inviteToken, req.user.id, now]
    );

    const lobby = await dbAsync.get(`SELECT * FROM lobbies WHERE id = ?`, [lobbyId]);
    const members = await dbAsync.all(`SELECT * FROM lobby_members WHERE lobbyId = ?`, [lobbyId]);

    res.status(201).json({
      lobby,
      members,
      inviteToken,
      yourRole: 'admin'
    });
  } catch (err) {
    console.error('Create Lobby Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Get Lobbies for Active User
router.get('/', verifyAuth, async (req, res) => {
  try {
    const lobbies = await dbAsync.all(
      `SELECT l.*, m.role as yourRole 
       FROM lobbies l 
       JOIN lobby_members m ON l.id = m.lobbyId 
       WHERE m.userId = ? 
       ORDER BY l.lastUpdatedAt DESC`,
      [req.user.id]
    );
    res.json({ lobbies });
  } catch (err) {
    console.error('Get Lobbies Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Get Specific Lobby Details & Members
router.get('/:lobbyId', verifyAuth, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const lobby = await dbAsync.get(`SELECT * FROM lobbies WHERE id = ?`, [lobbyId]);
    if (!lobby) {
      return res.status(404).json({ error: 'Lobby not found' });
    }

    const members = await dbAsync.all(`SELECT * FROM lobby_members WHERE lobbyId = ?`, [lobbyId]);
    const membership = members.find(m => m.userId === req.user.id);

    if (!membership && !lobby.isPublic) {
      return res.status(403).json({ error: 'You are not a member of this lobby' });
    }

    const invites = membership && membership.role === 'admin' 
      ? await dbAsync.all(`SELECT * FROM invites WHERE lobbyId = ? AND isRevoked = 0`, [lobbyId]) 
      : [];

    res.json({
      lobby,
      members,
      invites,
      yourRole: membership ? membership.role : 'viewer'
    });
  } catch (err) {
    console.error('Get Lobby Details Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Generate New Invite Link / Token
router.post('/:lobbyId/invites', verifyAuth, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const { defaultRole, maxUses, expiresAt } = req.body;

    const membership = await dbAsync.get(
      `SELECT role FROM lobby_members WHERE lobbyId = ? AND userId = ?`,
      [lobbyId, req.user.id]
    );

    if (!membership || membership.role !== 'admin') {
      return res.status(403).json({ error: 'Only admins can generate invite links' });
    }

    const inviteId = `inv_${crypto.randomBytes(8).toString('hex')}`;
    const token = crypto.randomBytes(8).toString('hex');
    const now = Date.now();
    const role = defaultRole || 'editor';

    await dbAsync.run(
      `INSERT INTO invites (id, lobbyId, token, createdBy, createdAt, expiresAt, maxUses, defaultRole)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [inviteId, lobbyId, token, req.user.id, now, expiresAt || null, maxUses || null, role]
    );

    const invite = await dbAsync.get(`SELECT * FROM invites WHERE id = ?`, [inviteId]);
    res.status(201).json({ invite });
  } catch (err) {
    console.error('Create Invite Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 5. Preview Invite Token Information
router.get('/invite-info/:token', async (req, res) => {
  try {
    const { token } = req.params;
    const invite = await dbAsync.get(`SELECT * FROM invites WHERE token = ? AND isRevoked = 0`, [token]);
    if (!invite) {
      return res.status(404).json({ error: 'Invalid or revoked invite link' });
    }

    if (invite.expiresAt && Date.now() > invite.expiresAt) {
      return res.status(410).json({ error: 'Invite link has expired' });
    }

    if (invite.maxUses && invite.usedCount >= invite.maxUses) {
      return res.status(410).json({ error: 'Invite link maximum usages reached' });
    }

    const lobby = await dbAsync.get(`SELECT id, title, description, photoCount FROM lobbies WHERE id = ?`, [invite.lobbyId]);
    res.json({ invite, lobby });
  } catch (err) {
    console.error('Preview Invite Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 6. Accept Invite Token and Join Lobby
router.post('/accept-invite/:token', verifyAuth, async (req, res) => {
  try {
    const { token } = req.params;
    const invite = await dbAsync.get(`SELECT * FROM invites WHERE token = ? AND isRevoked = 0`, [token]);
    if (!invite) {
      return res.status(404).json({ error: 'Invalid or revoked invite link' });
    }

    // Check if user is already a member
    const existing = await dbAsync.get(
      `SELECT * FROM lobby_members WHERE lobbyId = ? AND userId = ?`,
      [invite.lobbyId, req.user.id]
    );

    if (existing) {
      const lobby = await dbAsync.get(`SELECT * FROM lobbies WHERE id = ?`, [invite.lobbyId]);
      return res.json({ message: 'Already a member', lobby, role: existing.role });
    }

    const memberId = `mem_${crypto.randomBytes(8).toString('hex')}`;
    const now = Date.now();

    await dbAsync.run(
      `INSERT INTO lobby_members (id, lobbyId, userId, email, displayName, avatar, role, joinedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [memberId, invite.lobbyId, req.user.id, req.user.email, req.user.displayName, req.user.avatar, invite.defaultRole || 'editor', now]
    );

    await dbAsync.run(
      `UPDATE invites SET usedCount = usedCount + 1 WHERE id = ?`,
      [invite.id]
    );

    const lobby = await dbAsync.get(`SELECT * FROM lobbies WHERE id = ?`, [invite.lobbyId]);
    const members = await dbAsync.all(`SELECT * FROM lobby_members WHERE lobbyId = ?`, [invite.lobbyId]);

    res.json({
      message: 'Joined lobby successfully',
      lobby,
      members,
      yourRole: invite.defaultRole || 'editor'
    });
  } catch (err) {
    console.error('Accept Invite Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
