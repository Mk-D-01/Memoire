/**
 * Mémoire — Collaborative Lobby Engine (Frontend)
 * Handles real-time multi-user lobbies, guest sessions, Socket.IO sync, invite links,
 * and Google Drive photo & caption backups.
 */

const API_BASE = window.MEMOIRE_API_BASE || localStorage.getItem('memoire_api_base') || 'http://localhost:3001';

const CollabEngine = {
  state: {
    isCollaborative: false,
    token: localStorage.getItem('memoire_collab_token') || null,
    user: null,
    activeLobby: null,
    myRole: 'viewer', // 'admin', 'editor', 'viewer'
    socket: null,
    lobbies: []
  },

  /**
   * Initialize collaborative system, check authentication and URL query parameters
   */
  async init() {
    if (this.state.token) {
      await this.fetchProfile();
    }

    const urlParams = new URLSearchParams(window.location.search);
    const inviteToken = urlParams.get('invite');
    if (inviteToken) {
      this.handleInviteFromUrl(inviteToken);
    }
  },

  /**
   * Fetch Profile using saved session token
   */
  async fetchProfile() {
    try {
      const res = await fetch(`${API_BASE}/auth/me`, {
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        this.state.user = data.user;
        this.updateHeaderProfileUI();
        await this.loadUserLobbies();
      } else {
        this.logout();
      }
    } catch (err) {
      console.warn('Backend server not reachable or offline at ' + API_BASE);
    }
  },

  /**
   * Fast Guest Authentication (1-click join without setup)
   */
  async loginAsGuest(displayName) {
    try {
      const res = await fetch(`${API_BASE}/auth/guest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName })
      });
      if (!res.ok) throw new Error('Guest login failed');
      const data = await res.json();
      this.state.token = data.token;
      this.state.user = data.user;
      localStorage.setItem('memoire_collab_token', data.token);
      this.updateHeaderProfileUI();
      await this.loadUserLobbies();
      if (typeof showToast === 'function') {
        showToast(`Welcome, ${data.user.displayName}! ✨`);
      }
      return data.user;
    } catch (err) {
      console.error(err);
      if (typeof showToast === 'function') {
        showToast('❌ Unable to connect to collaborative server at ' + API_BASE);
      }
      throw err;
    }
  },

  /**
   * Logout from collaborative session
   */
  logout() {
    this.state.token = null;
    this.state.user = null;
    this.state.activeLobby = null;
    this.state.isCollaborative = false;
    localStorage.removeItem('memoire_collab_token');
    if (this.state.socket) {
      this.state.socket.disconnect();
      this.state.socket = null;
    }
    this.updateHeaderProfileUI();
    if (typeof loadFromIDB === 'function') {
      loadFromIDB().then(() => {
        if (typeof renderUI === 'function') renderUI();
      });
    }
  },

  /**
   * Load User's Lobbies List
   */
  async loadUserLobbies() {
    if (!this.state.token) return [];
    try {
      const res = await fetch(`${API_BASE}/lobbies`, {
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      if (res.ok) {
        const data = await res.json();
        this.state.lobbies = data.lobbies || [];
        this.renderLobbyListModal();
        return this.state.lobbies;
      }
    } catch (err) {
      console.error('Failed to load user lobbies', err);
    }
    return [];
  },

  /**
   * Create New Lobby
   */
  async createLobby(title, description, isPublic = false) {
    if (!this.state.token) {
      throw new Error('Must be signed in to create a lobby');
    }
    const res = await fetch(`${API_BASE}/lobbies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      },
      body: JSON.stringify({ title, description, isPublic })
    });
    if (!res.ok) throw new Error('Failed to create lobby');
    const data = await res.json();
    await this.loadUserLobbies();
    await this.switchToLobby(data.lobby.id);
    return data;
  },

  /**
   * Accept Invite & Join Lobby
   */
  async joinLobbyByToken(inviteToken) {
    if (!this.state.token) {
      throw new Error('Must be signed in to join a lobby');
    }
    const res = await fetch(`${API_BASE}/lobbies/accept-invite/${inviteToken}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.state.token}` }
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to join lobby');
    }
    const data = await res.json();
    await this.loadUserLobbies();
    await this.switchToLobby(data.lobby.id);
    if (typeof showToast === 'function') {
      showToast(`Joined "${data.lobby.title}"! 🎉`);
    }
    return data;
  },

  /**
   * Switch Active View to Collaborative Lobby
   */
  async switchToLobby(lobbyId) {
    if (!this.state.token) return;
    try {
      const res = await fetch(`${API_BASE}/lobbies/${lobbyId}`, {
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch lobby details');
      const data = await res.json();

      this.state.activeLobby = data.lobby;
      this.state.myRole = data.yourRole;
      this.state.isCollaborative = true;

      this.connectSocket(lobbyId);
      await this.fetchLobbyPhotos(lobbyId);
      this.updateLobbyBannerUI();

      if (typeof showToast === 'function') {
        showToast(`Connected to live lobby: ${data.lobby.title} 👥`);
      }
    } catch (err) {
      console.error('Failed to switch to lobby:', err);
    }
  },

  /**
   * Switch back to Personal Memory Book (Local IDB)
   */
  switchToPersonalMode() {
    if (this.state.socket && this.state.activeLobby) {
      this.state.socket.emit('leave_lobby', { lobbyId: this.state.activeLobby.id });
    }
    this.state.isCollaborative = false;
    this.state.activeLobby = null;
    this.updateLobbyBannerUI();
    if (typeof loadFromIDB === 'function') {
      loadFromIDB().then(() => {
        if (typeof renderUI === 'function') renderUI();
      });
    }
    if (typeof showToast === 'function') {
      showToast('Switched to Personal Memory Book 📖');
    }
  },

  /**
   * Fetch Lobby Photos from Server
   */
  async fetchLobbyPhotos(lobbyId) {
    try {
      const res = await fetch(`${API_BASE}/lobbies/${lobbyId}/photos`, {
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch lobby photos');
      const data = await res.json();

      if (typeof photos !== 'undefined') {
        photos = data.photos.map(p => ({
          id: p.id,
          dataUrl: p.dataUrl,
          caption: p.caption || '',
          uploadedBy: p.uploaderName || 'Anonymous',
          uploadedAvatar: p.uploaderAvatar,
          addedAt: p.uploadedAt
        }));
        if (typeof renderUI === 'function') renderUI();
      }
    } catch (err) {
      console.error('Fetch lobby photos error:', err);
    }
  },

  /**
   * Upload Photos to Active Lobby Server & User's Google Drive Folder
   */
  async uploadLobbyPhotos(photoArray) {
    if (!this.state.activeLobby || !this.state.token) return false;
    try {
      if (typeof DriveSync !== 'undefined' && DriveSync.isSignedIn) {
        for (const item of photoArray) {
          try {
            const driveRes = await DriveSync.uploadPhotoToDrive(item.dataUrl, item.filename, item.caption);
            item.driveFileId = driveRes.driveFileId;
            item.driveViewLink = driveRes.webViewLink;
          } catch (dErr) {
            console.warn('Google Drive auto-upload warning:', dErr);
          }
        }
      }

      const res = await fetch(`${API_BASE}/lobbies/${this.state.activeLobby.id}/photos/upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify({ photos: photoArray })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      return true;
    } catch (err) {
      console.error('Upload to lobby failed:', err);
      if (typeof showToast === 'function') {
        showToast(`❌ ${err.message}`);
      }
      return false;
    }
  },

  /**
   * Edit Caption on Server and Google Drive
   */
  async updatePhotoCaption(photoId, caption) {
    if (!this.state.activeLobby || !this.state.token) return;
    try {
      const item = typeof photos !== 'undefined' ? photos.find(p => p.id === photoId) : null;
      if (item && item.driveFileId && typeof DriveSync !== 'undefined' && DriveSync.isSignedIn) {
        DriveSync.updateDrivePhotoCaption(item.driveFileId, caption);
      }

      await fetch(`${API_BASE}/lobbies/${this.state.activeLobby.id}/photos/${photoId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.state.token}`
        },
        body: JSON.stringify({ caption })
      });
    } catch (err) {
      console.error('Update caption failed:', err);
    }
  },

  /**
   * Delete Photo on Server
   */
  async deletePhoto(photoId) {
    if (!this.state.activeLobby || !this.state.token) return false;
    try {
      const res = await fetch(`${API_BASE}/lobbies/${this.state.activeLobby.id}/photos/${photoId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Delete failed');
      }
      return true;
    } catch (err) {
      console.error('Delete photo failed:', err);
      if (typeof showToast === 'function') {
        showToast(`❌ ${err.message}`);
      }
      return false;
    }
  },

  /**
   * Connect Socket.IO
   */
  connectSocket(lobbyId) {
    if (typeof io === 'undefined') return;

    if (!this.state.socket) {
      this.state.socket = io(API_BASE);

      this.state.socket.on('connect', () => {
        if (this.state.token) {
          this.state.socket.emit('authenticate', { token: this.state.token });
        }
        if (this.state.activeLobby) {
          this.state.socket.emit('join_lobby', { lobbyId: this.state.activeLobby.id });
        }
      });

      this.state.socket.on('photo_added', ({ photo, uploadedBy }) => {
        if (typeof photos !== 'undefined') {
          if (!photos.some(p => p.id === photo.id)) {
            photos.unshift({
              id: photo.id,
              dataUrl: photo.dataUrl,
              caption: photo.caption || '',
              uploadedBy: photo.uploaderName || uploadedBy || 'Collaborator',
              uploadedAvatar: photo.uploaderAvatar,
              addedAt: photo.uploadedAt
            });
            if (typeof renderUI === 'function') renderUI();
            if (typeof showToast === 'function') {
              showToast(`📸 ${photo.uploaderName || uploadedBy} added a photo!`);
            }
          }
        }
      });

      this.state.socket.on('caption_updated', ({ photoId, caption }) => {
        if (typeof photos !== 'undefined') {
          const item = photos.find(p => p.id === photoId);
          if (item) {
            item.caption = caption;
            if (typeof renderUI === 'function') renderUI();
          }
        }
      });

      this.state.socket.on('photo_deleted', ({ photoId, deletedBy }) => {
        if (typeof photos !== 'undefined') {
          photos = photos.filter(p => p.id !== photoId);
          if (typeof renderUI === 'function') renderUI();
          if (typeof showToast === 'function') {
            showToast(`🗑 A photo was removed by ${deletedBy}`);
          }
        }
      });

      this.state.socket.on('member_joined_room', ({ displayName }) => {
        if (typeof showToast === 'function') {
          showToast(`👋 ${displayName} joined live!`);
        }
      });
    } else {
      this.state.socket.emit('join_lobby', { lobbyId });
    }
  },

  /**
   * Handle Invite Token from URL
   */
  async handleInviteFromUrl(inviteToken) {
    if (!this.state.token) {
      const name = prompt('Enter your name to join this memory lobby:', 'Memory Maker');
      if (name) {
        await this.loginAsGuest(name);
      } else {
        return;
      }
    }
    try {
      await this.joinLobbyByToken(inviteToken);
    } catch (err) {
      if (typeof showToast === 'function') {
        showToast(`❌ ${err.message}`);
      }
    }
  },

  /**
   * UI Helpers
   */
  openLobbyModal() {
    const modal = document.getElementById('lobbyModal');
    if (modal) {
      this.renderLobbyListModal();
      modal.classList.add('active');
      document.body.style.overflow = 'hidden';
    }
  },

  closeLobbyModal() {
    const modal = document.getElementById('lobbyModal');
    if (modal) {
      modal.classList.remove('active');
      document.body.style.overflow = '';
    }
  },

  renderLobbyListModal() {
    const body = document.getElementById('lobbyModalBody');
    if (!body) return;

    if (!this.state.user) {
      body.innerHTML = `
        <div class="lobby-welcome-box">
          <h3>👥 Collaborative Memory Lobbies</h3>
          <p>Join or create shared spaces where you and your friends can add photos, comment, and view memories together in real-time!</p>
          <div class="lobby-guest-form">
            <input type="text" id="guestNameInput" placeholder="Enter your display name..." class="captions-search-input" style="margin-bottom:12px;" />
            <button class="btn btn-primary" id="btnGuestLoginSubmit" style="width:100%;">Join as Guest →</button>
          </div>
        </div>
      `;
      setTimeout(() => {
        const btn = document.getElementById('btnGuestLoginSubmit');
        const inp = document.getElementById('guestNameInput');
        if (btn && inp) {
          btn.addEventListener('click', async () => {
            if (!inp.value.trim()) return;
            await this.loginAsGuest(inp.value.trim());
          });
        }
      }, 50);
      return;
    }

    let lobbiesHtml = '';
    if (this.state.lobbies.length === 0) {
      lobbiesHtml = `<div class="captions-empty-msg">You haven't joined any lobbies yet. Create one below!</div>`;
    } else {
      lobbiesHtml = this.state.lobbies.map(l => `
        <div class="caption-row" style="margin-bottom:10px;">
          <div class="caption-row-info">
            <div class="caption-row-num"><strong>${l.title}</strong> (${l.photoCount || 0} photos)</div>
            <div class="caption-row-text">${l.description || 'Shared space'}</div>
          </div>
          <button class="btn btn-sm btn-ghost btn-switch-lobby" data-id="${l.id}">Open ↗</button>
        </div>
      `).join('');
    }

    body.innerHTML = `
      <div class="lobby-user-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div>Signed in as <strong>${this.state.user.displayName}</strong></div>
        <button class="btn btn-sm btn-ghost" id="btnCollabLogout">Sign Out</button>
      </div>
      <div style="margin-bottom:16px;">
        <button class="btn btn-primary" id="btnCreateLobbyPrompt" style="width:100%;">+ Create New Memory Lobby</button>
      </div>
      ${this.state.isCollaborative ? `
        <div style="margin-bottom:16px;">
          <button class="btn btn-ghost" id="btnReturnPersonal" style="width:100%;">📖 Return to Personal Memory Book</button>
        </div>
      ` : ''}
      <h4>Your Lobbies</h4>
      <div class="lobby-list">${lobbiesHtml}</div>
    `;

    setTimeout(() => {
      document.getElementById('btnCollabLogout')?.addEventListener('click', () => this.logout());
      document.getElementById('btnReturnPersonal')?.addEventListener('click', () => {
        this.switchToPersonalMode();
        this.closeLobbyModal();
      });
      document.getElementById('btnCreateLobbyPrompt')?.addEventListener('click', async () => {
        const title = prompt('Lobby Title (e.g., Summer Trip 2026):');
        if (!title) return;
        const desc = prompt('Description (optional):', 'Our shared memories');
        try {
          await this.createLobby(title, desc || '');
          this.closeLobbyModal();
        } catch(e) { alert(e.message); }
      });
      document.querySelectorAll('.btn-switch-lobby').forEach(b => {
        b.addEventListener('click', () => {
          this.switchToLobby(b.dataset.id);
          this.closeLobbyModal();
        });
      });
    }, 50);
  },

  updateHeaderProfileUI() {},
  updateLobbyBannerUI() {}
};

// Auto-initialize on load
document.addEventListener('DOMContentLoaded', () => CollabEngine.init());
