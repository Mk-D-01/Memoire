/**
 * Mémoire — Collaborative Lobby Engine (Frontend)
 * Handles real-time multi-user lobbies, guest sessions, Socket.IO sync, and invite links.
 */

const API_BASE = 'http://localhost:3001';

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

    // Check URL query params for invite token: e.g. ?invite=abc123xyz
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
      console.warn('Backend server not reachable or offline.', err);
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
    // Switch back to local IndexedDB
    if (typeof loadPhotos === 'function') {
      loadPhotos();
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

      // Connect Socket.IO for real-time updates
      this.connectSocket(lobbyId);

      // Fetch photos from server
      await this.fetchLobbyPhotos(lobbyId);

      // Update UI Header and Banner
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
    this.state.isCollaborative = false;
    this.state.activeLobby = null;
    if (this.state.socket) {
      this.state.socket.emit('leave_lobby', { lobbyId: this.state.activeLobby?.id });
    }
    this.updateLobbyBannerUI();
    if (typeof loadPhotos === 'function') {
      loadPhotos();
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

      // Update global photos array in app.js
      if (typeof photos !== 'undefined') {
        photos = data.photos.map(p => ({
          id: p.id,
          dataUrl: p.dataUrl,
          caption: p.caption || '',
          uploadedBy: p.uploaderName || 'Anonymous',
          uploadedAvatar: p.uploaderAvatar,
          addedAt: p.uploadedAt
        }));
        if (typeof renderCollage === 'function') {
          renderCollage();
        }
        if (typeof updateStats === 'function') {
          updateStats();
        }
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
      // If Google Drive is connected, auto-upload photos and captions to Drive folder
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
          // Check if photo already exists
          if (!photos.some(p => p.id === photo.id)) {
            photos.unshift({
              id: photo.id,
              dataUrl: photo.dataUrl,
              caption: photo.caption || '',
              uploadedBy: photo.uploaderName || uploadedBy || 'Collaborator',
              uploadedAvatar: photo.uploaderAvatar,
              addedAt: photo.uploadedAt
            });
            if (typeof renderCollage === 'function') renderCollage();
            if (typeof updateStats === 'function') updateStats();
            if (typeof showToast === 'function') {
              showToast(`📸 ${photo.uploaderName || uploadedBy} added a photo!`);
            }
          }
        }
      });

      this.state.socket.on('caption_updated', ({ photoId, caption, editedBy }) => {
        if (typeof photos !== 'undefined') {
          const item = photos.find(p => p.id === photoId);
          if (item) {
            item.caption = caption;
            if (typeof renderCollage === 'function') renderCollage();
          }
        }
      });

      this.state.socket.on('photo_deleted', ({ photoId, deletedBy }) => {
        if (typeof photos !== 'undefined') {
          photos = photos.filter(p => p.id !== photoId);
          if (typeof renderCollage === 'function') renderCollage();
          if (typeof updateStats === 'function') updateStats();
          if (typeof showToast === 'function') {
            showToast(`🗑 A photo was removed by ${deletedBy}`);
          }
        }
      });

      this.state.socket.on('member_joined_room', ({ displayName }) => {
        if (typeof showToast === 'function') {
          showToast(`👋 ${displayName} joined the lobby live!`);
        }
      });
    } else {
      this.state.socket.emit('join_lobby', { lobbyId });
    }
  },

  /**
   * Handle Invite Token from URL
   */
  async handleInviteFromUrl(token) {
    try {
      const res = await fetch(`${API_BASE}/lobbies/invite-info/${token}`);
      if (!res.ok) return;
      const data = await res.json();
      this.pendingInvite = { token, lobby: data.lobby };
      this.openLobbyModal();
    } catch (err) {
      console.warn('Invalid invite link', err);
    }
  },

  /**
   * Copy Invite Link to Clipboard
   */
  async copyInviteLink() {
    if (!this.state.activeLobby || !this.state.token) return;
    try {
      const res = await fetch(`${API_BASE}/lobbies/${this.state.activeLobby.id}`, {
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      const data = await res.json();
      let token = data.invites && data.invites.length > 0 ? data.invites[0].token : null;

      if (!token) {
        const invRes = await fetch(`${API_BASE}/lobbies/${this.state.activeLobby.id}/invites`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.state.token}`
          },
          body: JSON.stringify({ defaultRole: 'editor' })
        });
        const invData = await invRes.json();
        token = invData.invite.token;
      }

      const shareUrl = `${window.location.origin}${window.location.pathname}?invite=${token}`;
      await navigator.clipboard.writeText(shareUrl);
      if (typeof showToast === 'function') {
        showToast('🔗 Invite link copied to clipboard!');
      }
    } catch (err) {
      console.error(err);
      if (typeof showToast === 'function') {
        showToast('❌ Failed to copy invite link');
      }
    }
  },

  /**
   * UI Updates & Modal Builders
   */
  updateHeaderProfileUI() {
    const btnLobby = document.getElementById('btnLobby');
    if (!btnLobby) return;

    if (this.state.user) {
      btnLobby.innerHTML = `
        <img src="${this.state.user.avatar}" class="user-avatar-small" alt="${this.state.user.displayName}" />
        <span class="user-name-small">${this.state.user.displayName.split(' ')[0]}</span>
      `;
      btnLobby.title = `Signed in as ${this.state.user.displayName}`;
    } else {
      btnLobby.innerHTML = `👥 Lobbies`;
      btnLobby.title = `Collaborative Lobbies`;
    }
  },

  updateLobbyBannerUI() {
    let banner = document.getElementById('collabBanner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'collabBanner';
      banner.className = 'collab-banner';
      document.body.prepend(banner);
    }

    if (this.state.isCollaborative && this.state.activeLobby) {
      banner.style.display = 'flex';
      banner.innerHTML = `
        <div class="collab-banner-inner">
          <div class="collab-status-badge">
            <span class="pulse-dot"></span> Live Lobby
          </div>
          <div class="collab-title">
            👥 <strong>${this.state.activeLobby.title}</strong>
            <span class="collab-role-pill role-${this.state.myRole}">${this.state.myRole.toUpperCase()}</span>
          </div>
          <div class="collab-actions">
            <button class="btn btn-sm btn-ghost" id="btnCopyInvite">🔗 Copy Invite Link</button>
            <button class="btn btn-sm btn-ghost" id="btnSwitchPersonal">📖 Exit to Personal Book</button>
          </div>
        </div>
      `;
      document.getElementById('btnCopyInvite')?.addEventListener('click', () => this.copyInviteLink());
      document.getElementById('btnSwitchPersonal')?.addEventListener('click', () => this.switchToPersonalMode());
    } else {
      banner.style.display = 'none';
    }
  },

  openLobbyModal() {
    const modal = document.getElementById('lobbyModal');
    if (modal) {
      modal.classList.add('active');
      this.renderLobbyModalContent();
    }
  },

  closeLobbyModal() {
    const modal = document.getElementById('lobbyModal');
    if (modal) modal.classList.remove('active');
  },

  renderLobbyModalContent() {
    const container = document.getElementById('lobbyModalBody');
    if (!container) return;

    if (this.pendingInvite) {
      container.innerHTML = `
        <div class="lobby-invite-box">
          <div class="invite-icon">💌</div>
          <h3>You're invited to join <strong>"${this.pendingInvite.lobby.title}"</strong>!</h3>
          <p>${this.pendingInvite.lobby.description || 'Share memories together in real-time.'}</p>
          ${!this.state.user ? `
            <div class="guest-login-wrap">
              <input type="text" id="guestNameInput" class="drive-url-input" placeholder="Enter your display name…" />
              <button class="btn btn-primary" id="btnGuestJoinInvite">✦ Join Lobby as Guest</button>
            </div>
          ` : `
            <button class="btn btn-primary" id="btnAcceptPendingInvite">Accept Invite & Join →</button>
          `}
        </div>
      `;

      document.getElementById('btnGuestJoinInvite')?.addEventListener('click', async () => {
        const name = document.getElementById('guestNameInput').value;
        await this.loginAsGuest(name);
        if (this.pendingInvite) {
          await this.joinLobbyByToken(this.pendingInvite.token);
          this.pendingInvite = null;
          this.closeLobbyModal();
        }
      });

      document.getElementById('btnAcceptPendingInvite')?.addEventListener('click', async () => {
        if (this.pendingInvite) {
          await this.joinLobbyByToken(this.pendingInvite.token);
          this.pendingInvite = null;
          this.closeLobbyModal();
        }
      });

      return;
    }

    if (!this.state.user) {
      container.innerHTML = `
        <div class="lobby-auth-box">
          <div class="auth-illustration">🤝</div>
          <h2>Collaborative Memory Lobbies</h2>
          <p>Create shared memory albums with friends, family, or partners. Photos and captions sync live across all screens.</p>
          <div class="guest-login-wrap">
            <input type="text" id="guestNameInput" class="drive-url-input" placeholder="Enter your display name…" />
            <button class="btn btn-primary btn-hero-collab" id="btnGuestLogin">✦ Start Collaborating</button>
          </div>
        </div>
      `;

      document.getElementById('btnGuestLogin')?.addEventListener('click', async () => {
        const name = document.getElementById('guestNameInput').value;
        await this.loginAsGuest(name);
        this.renderLobbyModalContent();
      });
      return;
    }

    // Signed in User View (Lobby List + Create New)
    container.innerHTML = `
      <div class="lobby-dashboard">
        <div class="dashboard-header">
          <div class="user-chip">
            <img src="${this.state.user.avatar}" class="user-avatar-med" />
            <div>
              <strong>${this.state.user.displayName}</strong>
              <div class="user-email-sub">${this.state.user.email}</div>
            </div>
          </div>
          <button class="btn btn-sm btn-ghost" id="btnCollabSignout">Sign Out</button>
        </div>

        <div class="create-lobby-card">
          <h4>✦ Create a New Shared Lobby</h4>
          <div class="create-lobby-inputs">
            <input type="text" id="newLobbyTitle" class="drive-url-input" placeholder="Lobby Title (e.g. Summer Vacation '26)" />
            <input type="text" id="newLobbyDesc" class="drive-url-input" placeholder="Optional description…" />
            <button class="btn btn-primary" id="btnCreateLobbySubmit">Create Lobby →</button>
          </div>
        </div>

        <div class="my-lobbies-section">
          <h4>Your Shared Lobbies (${this.state.lobbies.length})</h4>
          <div class="lobbies-grid" id="lobbiesGrid">
            ${this.state.lobbies.length === 0 ? `<p class="empty-sub">No shared lobbies yet. Create one above!</p>` : ''}
            ${this.state.lobbies.map(l => `
              <div class="lobby-card ${this.state.activeLobby?.id === l.id ? 'active-card' : ''}" data-id="${l.id}">
                <div class="lobby-card-header">
                  <strong>${l.title}</strong>
                  <span class="role-badge">${l.yourRole}</span>
                </div>
                <p class="lobby-card-desc">${l.description || 'Shared photo gallery'}</p>
                <div class="lobby-card-footer">
                  <span>📸 ${l.photoCount || 0} photos</span>
                  <button class="btn btn-sm btn-ghost btn-open-lobby" data-id="${l.id}">
                    ${this.state.activeLobby?.id === l.id ? 'Active' : 'Open Lobby →'}
                  </button>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    document.getElementById('btnCollabSignout')?.addEventListener('click', () => {
      this.logout();
      this.renderLobbyModalContent();
    });

    document.getElementById('btnCreateLobbySubmit')?.addEventListener('click', async () => {
      const title = document.getElementById('newLobbyTitle').value;
      const desc = document.getElementById('newLobbyDesc').value;
      if (!title || !title.trim()) {
        if (typeof showToast === 'function') showToast('Please enter a title for your lobby');
        return;
      }
      await this.createLobby(title.trim(), desc.trim());
      this.closeLobbyModal();
    });

    document.querySelectorAll('.btn-open-lobby').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        await this.switchToLobby(id);
        this.closeLobbyModal();
      });
    });
  },

  renderLobbyListModal() {
    if (document.getElementById('lobbyModal')?.classList.contains('active')) {
      this.renderLobbyModalContent();
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  CollabEngine.init();
});
