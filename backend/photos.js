const express = require('express');
const crypto = require('crypto');
const { dbAsync } = require('./db');
const { verifyAuth } = require('./auth');

const router = express.Router({ mergeParams: true });

// Helper to check user permission in lobby
async function getMemberPermission(lobbyId, userId) {
  const member = await dbAsync.get(
    `SELECT role FROM lobby_members WHERE lobbyId = ? AND userId = ?`,
    [lobbyId, userId]
  );
  return member ? member.role : null;
}

// 1. Get Photos for Lobby
router.get('/', verifyAuth, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const role = await getMemberPermission(lobbyId, req.user.id);
    if (!role) {
      return res.status(403).json({ error: 'You are not a member of this lobby' });
    }

    const photos = await dbAsync.all(
      `SELECT * FROM photos WHERE lobbyId = ? AND isDeleted = 0 ORDER BY uploadedAt DESC`,
      [lobbyId]
    );

    res.json({ photos, total: photos.length });
  } catch (err) {
    console.error('Get Photos Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 2. Upload Photo to Lobby
router.post('/upload', verifyAuth, async (req, res) => {
  try {
    const { lobbyId } = req.params;
    const role = await getMemberPermission(lobbyId, req.user.id);
    if (!role || role === 'viewer') {
      return res.status(403).json({ error: 'Viewers cannot upload photos' });
    }

    const { photos } = req.body; // Array of { dataUrl, filename, caption, size }
    if (!photos || !Array.isArray(photos) || photos.length === 0) {
      return res.status(400).json({ error: 'No photos provided' });
    }

    const insertedPhotos = [];
    const now = Date.now();

    for (const item of photos) {
      if (!item.dataUrl) continue;
      const photoId = `img_${now}_${crypto.randomBytes(4).toString('hex')}`;
      const filename = item.filename || 'memory.jpg';
      const caption = item.caption || '';
      const size = item.size || item.dataUrl.length;

      await dbAsync.run(
        `INSERT INTO photos (id, lobbyId, filename, caption, dataUrl, size, uploadedBy, uploaderName, uploaderAvatar, uploadedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [photoId, lobbyId, filename, caption, item.dataUrl, size, req.user.id, req.user.displayName, req.user.avatar, now]
      );

      const newPhoto = await dbAsync.get(`SELECT * FROM photos WHERE id = ?`, [photoId]);
      insertedPhotos.push(newPhoto);
    }

    // Update lobby lastUpdatedAt and photoCount
    await dbAsync.run(
      `UPDATE lobbies SET photoCount = (SELECT COUNT(*) FROM photos WHERE lobbyId = ? AND isDeleted = 0), lastUpdatedAt = ? WHERE id = ?`,
      [lobbyId, now, lobbyId]
    );

    // Get io instance from app if registered
    const io = req.app.get('io');
    if (io) {
      for (const photo of insertedPhotos) {
        io.to(lobbyId).emit('photo_added', {
          photo,
          uploadedBy: req.user.displayName,
          timestamp: now
        });
      }
    }

    res.status(201).json({ photos: insertedPhotos });
  } catch (err) {
    console.error('Upload Photo Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 3. Edit Photo Caption
router.patch('/:photoId', verifyAuth, async (req, res) => {
  try {
    const { lobbyId, photoId } = req.params;
    const { caption } = req.body;

    const photo = await dbAsync.get(`SELECT * FROM photos WHERE id = ? AND lobbyId = ?`, [photoId, lobbyId]);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const role = await getMemberPermission(lobbyId, req.user.id);
    if (!role || role === 'viewer') {
      return res.status(403).json({ error: 'Permission denied to edit caption' });
    }

    // Editors can edit any caption or own photo
    await dbAsync.run(
      `UPDATE photos SET caption = ? WHERE id = ?`,
      [caption, photoId]
    );

    const updatedPhoto = await dbAsync.get(`SELECT * FROM photos WHERE id = ?`, [photoId]);

    const io = req.app.get('io');
    if (io) {
      io.to(lobbyId).emit('caption_updated', {
        photoId,
        caption,
        editedBy: req.user.displayName,
        timestamp: Date.now()
      });
    }

    res.json({ photo: updatedPhoto });
  } catch (err) {
    console.error('Edit Caption Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// 4. Delete Photo
router.delete('/:photoId', verifyAuth, async (req, res) => {
  try {
    const { lobbyId, photoId } = req.params;

    const photo = await dbAsync.get(`SELECT * FROM photos WHERE id = ? AND lobbyId = ?`, [photoId, lobbyId]);
    if (!photo) {
      return res.status(404).json({ error: 'Photo not found' });
    }

    const role = await getMemberPermission(lobbyId, req.user.id);
    if (!role) {
      return res.status(403).json({ error: 'Permission denied' });
    }

    // Admin can delete any photo, Editor can delete own upload
    if (role !== 'admin' && photo.uploadedBy !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own photos unless you are an admin' });
    }

    await dbAsync.run(
      `UPDATE photos SET isDeleted = 1 WHERE id = ?`,
      [photoId]
    );

    const now = Date.now();
    await dbAsync.run(
      `UPDATE lobbies SET photoCount = (SELECT COUNT(*) FROM photos WHERE lobbyId = ? AND isDeleted = 0), lastUpdatedAt = ? WHERE id = ?`,
      [lobbyId, now, lobbyId]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(lobbyId).emit('photo_deleted', {
        photoId,
        deletedBy: req.user.displayName,
        timestamp: now
      });
    }

    res.json({ success: true, photoId });
  } catch (err) {
    console.error('Delete Photo Error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
