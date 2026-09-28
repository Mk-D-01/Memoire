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
    activeInviteToken: null,
    activeDriveFolderId: null,
    driveSyncTimer: null,
    driveOnly: false,
    myRole: 'viewer', // 'admin', 'editor', 'viewer'
    socket: null,
    lobbies: []
  },

  /**
   * Initialize collaborative system, check authentication and URL query parameters
   */
  async init() {
    const urlParams = new URLSearchParams(window.location.search);
    const driveFolderId = urlParams.get('driveFolder');
    if (driveFolderId) {
      this.activateDriveSpace(driveFolderId, false);
    } else if (this.state.token) {
      await this.fetchProfile();
    }
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
    this.state.activeInviteToken = null;
    this.state.activeDriveFolderId = null;
    this.state.driveOnly = false;
    clearInterval(this.state.driveSyncTimer);
    this.state.driveSyncTimer = null;
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
    let driveFolderId = null;
    if (typeof DriveSync !== 'undefined' && DriveSync.isSignedIn) {
      try {
        const folder = await DriveSync.createSharedFolder(`Mémoire — ${title.trim()}`);
        driveFolderId = folder.folderId;
      } catch (dErr) {
        console.warn('Optional Drive folder sync skipped:', dErr);
      }
    }
    const res = await fetch(`${API_BASE}/lobbies`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.state.token}`
      },
      body: JSON.stringify({ title, description, isPublic, driveFolderId })
    });
    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Failed to create lobby on server');
    }
    const data = await res.json();
    this.state.activeInviteToken = data.inviteToken || null;
    await this.loadUserLobbies();
    await this.switchToLobby(data.lobby.id);
    return data;
  },

  async createDriveSpace() {
    if (typeof DriveSync === 'undefined' || !DriveSync.isSignedIn) {
      showToast('Connect Google Drive first, then create the shared space.');
      document.getElementById('btnDriveImport')?.click();
      return;
    }
    const title = prompt('Shared space name:', 'Our Shared Memories');
    if (!title?.trim()) return;
    try {
      const folder = await DriveSync.createSharedFolder(`Mémoire — ${title.trim()}`);
      await this.activateDriveSpace(folder.folderId, true, title.trim());
    } catch (err) {
      showToast(`❌ ${err.message}`);
    }
  },

  async activateDriveSpace(folderId, updateUrl = true, title = 'Shared Drive Space') {
    if (!folderId) return;
    this.state.driveOnly = true;
    this.state.isCollaborative = true;
    this.state.activeDriveFolderId = folderId;
    this.state.activeLobby = { id: `drive_${folderId}`, title, driveFolderId: folderId };
    if (typeof DriveSync !== 'undefined') DriveSync.setSharedFolder(folderId);

    if (updateUrl) {
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('driveFolder', folderId);
      window.history.replaceState({}, '', url);
    }

    await this.fetchLobbyPhotos(this.state.activeLobby.id);
    clearInterval(this.state.driveSyncTimer);
    this.state.driveSyncTimer = setInterval(
      () => this.fetchLobbyPhotos(this.state.activeLobby.id),
      15000
    );
    this.renderLobbyListModal();
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
      this.state.activeInviteToken = data.invites?.[0]?.token || this.state.activeInviteToken;
      this.state.activeDriveFolderId = data.lobby.driveFolderId || null;
      this.state.isCollaborative = true;

      if (this.state.activeDriveFolderId && typeof DriveSync !== 'undefined') {
        DriveSync.setSharedFolder(this.state.activeDriveFolderId);
      }

      this.connectSocket(lobbyId);
      await this.fetchLobbyPhotos(lobbyId);
      clearInterval(this.state.driveSyncTimer);
      if (this.state.activeDriveFolderId) {
        this.state.driveSyncTimer = setInterval(() => this.fetchLobbyPhotos(lobbyId), 15000);
      }
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
    this.state.activeInviteToken = null;
    this.state.activeDriveFolderId = null;
    this.state.driveOnly = false;
    clearInterval(this.state.driveSyncTimer);
    this.state.driveSyncTimer = null;
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
      if (this.state.activeDriveFolderId) {
        if (typeof DriveSync === 'undefined' || !DriveSync.isSignedIn) {
          throw new Error('Connect Google Drive to view this shared space');
        }
        const drivePhotos = await DriveSync.fetchFolderPhotos(this.state.activeDriveFolderId);
        if (typeof photos !== 'undefined') {
          photos = drivePhotos;
          if (typeof renderUI === 'function') renderUI();
        }
        return;
      }
      const res = await fetch(`${API_BASE}/lobbies/${lobbyId}/photos`, {
        headers: { 'Authorization': `Bearer ${this.state.token}` }
      });
      if (!res.ok) throw new Error('Failed to fetch lobby photos');
      const data = await res.json();

      if (typeof photos !== 'undefined') {
        photos = data.photos.map(p => ({
          id: p.id,
          dataUrl: p.dataUrl,
          filename: p.filename,
          caption: p.caption || '',
          uploadedBy: p.uploaderName || 'Anonymous',
          uploadedAvatar: p.uploaderAvatar,
          driveFileId: p.driveFileId,
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
    if (!this.state.activeLobby || (!this.state.token && !this.state.driveOnly)) return false;
    try {
      if (this.state.activeDriveFolderId) {
        if (typeof DriveSync === 'undefined' || !DriveSync.isSignedIn) {
          throw new Error('Connect Google Drive before uploading to this shared space');
        }
        for (const item of photoArray) {
          const drivePhoto = await DriveSync.uploadPhotoToFolder(
            this.state.activeDriveFolderId,
            item.dataUrl,
            item.filename,
            item.caption
          );
          item.driveFileId = drivePhoto.id;
        }
        await this.fetchLobbyPhotos(this.state.activeLobby.id);
        return true;
      }
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

  getShareUrl() {
    if (this.state.driveOnly && this.state.activeDriveFolderId) {
      const url = new URL(window.location.href);
      url.search = '';
      url.searchParams.set('driveFolder', this.state.activeDriveFolderId);
      return url.toString();
    }
    if (!this.state.activeInviteToken) return '';
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('invite', this.state.activeInviteToken);
    return url.toString();
  },

  async copyShareUrl() {
    const shareUrl = this.getShareUrl();
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('🔗 Join link copied!');
    } catch (err) {
      const input = document.getElementById('lobbyShareUrl');
      if (!input) return;
      input.focus();
      input.select();
      document.execCommand('copy');
      showToast('🔗 Join link copied!');
    }
  },

  /**
   * Edit Caption on Server and Google Drive
   */
  async updatePhotoCaption(photoId, caption) {
    if (!this.state.activeLobby || (!this.state.token && !this.state.driveOnly)) return;
    try {
      const item = typeof photos !== 'undefined' ? photos.find(p => p.id === photoId) : null;
      if (item && item.driveFileId && typeof DriveSync !== 'undefined' && DriveSync.isSignedIn) {
        await DriveSync.updateDrivePhotoCaption(item.driveFileId, caption);
      }
      if (this.state.activeDriveFolderId) {
        await this.fetchLobbyPhotos(this.state.activeLobby.id);
        return;
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
    if (!this.state.activeLobby || (!this.state.token && !this.state.driveOnly)) return false;
    try {
      const item = typeof photos !== 'undefined' ? photos.find(p => p.id === photoId) : null;
      if (this.state.activeDriveFolderId) {
        if (!item?.driveFileId) throw new Error('Drive file not found');
        await DriveSync.deleteDriveFile(item.driveFileId);
        photos = photos.filter(photo => photo.id !== photoId);
        if (typeof renderUI === 'function') renderUI();
        return true;
      }
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
        } else if (this.state.activeLobby) {
          this.state.socket.emit('join_lobby', { lobbyId: this.state.activeLobby.id });
        }
      });

      this.state.socket.on('authenticated', () => {
        if (this.state.activeLobby) {
          this.state.socket.emit('join_lobby', { lobbyId: this.state.activeLobby.id });
        }
      });

      this.state.socket.on('connect_error', err => {
        console.warn('Live collaboration connection failed:', err.message);
      });

      this.state.socket.on('reconnect', () => {
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
              filename: photo.filename,
              uploadedBy: photo.uploaderName || uploadedBy || 'Collaborator',
              uploadedAvatar: photo.uploaderAvatar,
              driveFileId: photo.driveFileId,
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

    if (this.state.driveOnly) {
      body.innerHTML = `
        <div class="lobby-welcome-box">
          <h3>☁️ ${this.escapeHtml(this.state.activeLobby?.title || 'Shared Drive Space')}</h3>
          <p>Photos are stored directly in the shared Google Drive folder. Everyone with Drive access can add and view memories.</p>
          <div class="lobby-share-panel">
            <strong>Share this space</strong>
            <div class="lobby-share-row">
              <input id="lobbyShareUrl" type="text" value="${this.escapeHtml(this.getShareUrl())}" readonly aria-label="Shared Drive space link" />
              <button class="btn btn-sm btn-primary" id="btnCopyLobbyLink" type="button">Copy link</button>
            </div>
          </div>
          <button class="btn btn-ghost" id="btnCreateAnotherDriveSpace" type="button" style="width:100%;">+ Create another space</button>
        </div>
      `;
      setTimeout(() => {
        document.getElementById('btnCopyLobbyLink')?.addEventListener('click', () => this.copyShareUrl());
        document.getElementById('btnCreateAnotherDriveSpace')?.addEventListener('click', () => this.createDriveSpace());
      }, 50);
      return;
    }

    if (!this.state.user) {
      body.innerHTML = `
        <div class="lobby-welcome-box">
          <h3>👥 Real-Time Memory Spaces</h3>
          <p>Collaborate in real-time with friends and family on a shared memory collage.</p>
          <div class="guest-login-wrap" style="margin-top:16px;">
            <label style="font-size:0.8rem; color:var(--text-secondary); display:block; margin-bottom:6px;">Join as a Collaborator:</label>
            <div style="display:flex; gap:8px;">
              <input id="guestNameInput" class="captions-search-input" placeholder="Your name (e.g., Maya)" style="flex:1;" />
              <button class="btn btn-primary" id="btnGuestLogin" style="white-space:nowrap;">Enter Space ✦</button>
            </div>
          </div>
          <div style="text-align:center; margin: 18px 0 14px; color:var(--text-muted); font-size:0.8rem;">— OR USE GOOGLE DRIVE —</div>
          <div style="display:flex; flex-direction:column; gap:8px;">
            <button class="btn btn-ghost" id="btnCreateDriveSpace" style="width:100%;">☁️ Create Shared Google Drive Space</button>
            <button class="btn btn-ghost" id="btnOpenDriveSpace" style="width:100%;">📁 Open Drive Folder Link</button>
          </div>
        </div>
      `;
      setTimeout(() => {
        const guestInput = document.getElementById('guestNameInput');
        const guestBtn = document.getElementById('btnGuestLogin');
        const doGuestLogin = async () => {
          const name = guestInput?.value?.trim();
          if (!name) {
            if (typeof showToast === 'function') showToast('Please enter your name');
            guestInput?.focus();
            return;
          }
          try {
            await this.loginAsGuest(name);
          } catch (e) {
            console.error(e);
          }
        };
        guestBtn?.addEventListener('click', doGuestLogin);
        guestInput?.addEventListener('keydown', e => { if (e.key === 'Enter') doGuestLogin(); });
        document.getElementById('btnCreateDriveSpace')?.addEventListener('click', () => this.createDriveSpace());
        document.getElementById('btnOpenDriveSpace')?.addEventListener('click', async () => {
          const input = prompt('Paste the Google Drive folder link or folder ID:');
          const match = input?.match(/(?:folders\/|id=)([a-zA-Z0-9_-]{10,})/) || input?.match(/^([a-zA-Z0-9_-]{10,})$/);
          if (match) await this.activateDriveSpace(match[1], true);
          else if (input && typeof showToast === 'function') showToast('That is not a valid Google Drive folder link.');
        });
      }, 50);
      return;
    }

    let lobbiesHtml = '';
    if (this.state.lobbies.length === 0) {
      lobbiesHtml = `<div class="captions-empty-msg" style="padding:20px 0;">You haven't joined any shared spaces yet. Create your first memory lobby below!</div>`;
    } else {
      lobbiesHtml = this.state.lobbies.map(l => {
        const isActive = this.state.activeLobby?.id === l.id;
        return `
          <div class="caption-row lobby-row ${isActive ? 'active-lobby-row' : ''}" style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:center;">
            <div class="caption-row-info lobby-row-info" style="flex:1;">
              <div class="caption-row-num"><strong>${this.escapeHtml(l.title)}</strong> <span style="font-size:0.75rem; color:var(--text-muted);">(${l.photoCount || 0} photos)</span> ${isActive ? '<span class="active-badge">● Active</span>' : ''}</div>
              <div class="caption-row-text" style="font-size:0.8rem; color:var(--text-secondary);">${this.escapeHtml(l.description || 'Shared collaborative space')}</div>
            </div>
            <button class="btn btn-sm ${isActive ? 'btn-primary' : 'btn-ghost'} btn-switch-lobby" data-id="${l.id}">
              ${isActive ? 'Active ✓' : 'Open ↗'}
            </button>
          </div>
        `;
      }).join('');
    }

    body.innerHTML = `
      <div class="lobby-user-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid var(--border);">
        <div>Signed in as <strong style="color:var(--accent-primary);">${this.escapeHtml(this.state.user.displayName)}</strong></div>
        <button class="btn btn-sm btn-ghost" id="btnCollabLogout">Sign Out</button>
      </div>
      <div style="margin-bottom:16px;">
        <button class="btn btn-primary" id="btnCreateLobbyPrompt" style="width:100%;">+ Create New Shared Space</button>
      </div>
      ${this.state.isCollaborative && this.state.activeInviteToken ? `
        <div class="lobby-share-panel">
          <div>
            <strong style="color:var(--accent-gold);">🔗 Invite Friends to "${this.escapeHtml(this.state.activeLobby?.title || 'This Space')}"</strong>
            <p style="font-size:0.78rem; color:var(--text-secondary); margin:4px 0 8px;">Anyone with this link can view and add memories to this space.</p>
          </div>
          <div class="lobby-share-row">
            <input id="lobbyShareUrl" type="text" value="${this.escapeHtml(this.getShareUrl())}" readonly aria-label="Lobby join link" />
            <button class="btn btn-sm btn-primary" id="btnCopyLobbyLink" type="button">Copy link</button>
          </div>
        </div>
      ` : ''}
      ${this.state.isCollaborative ? `
        <div style="margin-bottom:16px;">
          <button class="btn btn-ghost" id="btnReturnPersonal" style="width:100%;">📖 Return to Personal Memory Book</button>
        </div>
      ` : ''}
      <h4 style="margin:16px 0 8px; font-family:var(--font-display); font-size:1.05rem;">Your Shared Spaces</h4>
      <div class="lobby-list">${lobbiesHtml}</div>
    `;

    setTimeout(() => {
      document.getElementById('btnCollabLogout')?.addEventListener('click', () => this.logout());
      document.getElementById('btnCopyLobbyLink')?.addEventListener('click', () => this.copyShareUrl());
      document.getElementById('btnReturnPersonal')?.addEventListener('click', () => {
        this.switchToPersonalMode();
        this.closeLobbyModal();
      });
      document.getElementById('btnCreateLobbyPrompt')?.addEventListener('click', async () => {
        const title = prompt('Space Title (e.g., Goa Trip 2026):');
        if (!title || !title.trim()) return;
        const desc = prompt('Description (optional):', 'Our shared memories');
        try {
          await this.createLobby(title.trim(), desc ? desc.trim() : '');
          this.closeLobbyModal();
        } catch(e) {
          alert(e.message);
        }
      });
      document.querySelectorAll('.btn-switch-lobby').forEach(b => {
        b.addEventListener('click', () => {
          this.switchToLobby(b.dataset.id);
          this.closeLobbyModal();
        });
      });
    }, 50);
  },

  escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  },

  updateHeaderProfileUI() {
    const btnLobby = document.getElementById('btnLobby');
    if (!btnLobby) return;
    if (this.state.user) {
      btnLobby.innerHTML = `👥 Space (${this.escapeHtml(this.state.user.displayName.split(' ')[0])})`;
      btnLobby.classList.add('active-user-btn');
    } else {
      btnLobby.innerHTML = `👥 Lobbies`;
      btnLobby.classList.remove('active-user-btn');
    }
  },

  updateLobbyBannerUI() {
    let banner = document.getElementById('collabActiveBanner');
    if (this.state.isCollaborative && this.state.activeLobby) {
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'collabActiveBanner';
        banner.className = 'collab-banner';
        const header = document.querySelector('.header');
        if (header) {
          header.insertAdjacentElement('afterend', banner);
        } else {
          document.body.insertAdjacentElement('afterbegin', banner);
        }
      }
      banner.innerHTML = `
        <div class="collab-banner-inner">
          <div class="collab-banner-title">
            <span class="collab-pulse-dot"></span>
            <span>Live Space: <strong>${this.escapeHtml(this.state.activeLobby.title)}</strong></span>
          </div>
          <div class="collab-banner-actions">
            <button class="btn btn-sm btn-primary" id="btnBannerInvite" type="button">🔗 Share Space</button>
            <button class="btn btn-sm btn-ghost" id="btnBannerPersonal" type="button">📖 Exit to Personal Book</button>
          </div>
        </div>
      `;
      banner.style.display = 'block';
      setTimeout(() => {
        document.getElementById('btnBannerInvite')?.addEventListener('click', () => {
          if (this.state.activeInviteToken || this.state.driveOnly) {
            this.copyShareUrl();
          } else {
            this.openLobbyModal();
          }
        });
        document.getElementById('btnBannerPersonal')?.addEventListener('click', () => {
          this.switchToPersonalMode();
        });
      }, 50);
    } else if (banner) {
      banner.style.display = 'none';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => CollabEngine.init());
