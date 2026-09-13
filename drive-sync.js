/**
 * drive-sync.js — Google Drive Integration & Cloud Folder Sync
 *
 * Saves/loads the Mémoire session to Google Drive, automatically creates a dedicated
 * `Mémoire Shared Photos` folder in user's Drive root, uploads photo files with captions,
 * and syncs collaborative photo galleries.
 *
 * Uses Google Identity Services (GIS) token model — no redirect popup flow.
 * Scopes: drive, drive.appdata
 */

const DriveSync = (() => {

  // ── Constants ──────────────────────────────────────────────────────────────
  const DEFAULT_CLIENT_ID = '384630933703-7cf7e1b7j1ljs1r0michq3grcf09pdsk.apps.googleusercontent.com';
  const SCOPE             = 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.appdata';
  const FOLDER_NAME       = 'Mémoire Shared Photos';
  const FILENAME          = 'memoire-session.json';
  const MIME_JSON         = 'application/json';
  const TOKEN_KEY         = 'memoire_gis_token_v2';
  const SAVE_DEBOUNCE_MS  = 3000; // wait 3s after last change before saving

  // ── State ──────────────────────────────────────────────────────────────────
  let _token           = null;   // current OAuth access token
  let _driveFileId     = null;   // cached Drive file ID for memoire-session.json
  let _userFolderId    = null;   // cached Drive folder ID for 'Mémoire Shared Photos'
  let _sharedFolderId  = null;   // active collaborative folder ID
  let _fetchedClientId = null;   // dynamically fetched Client ID from environment
  let _saveTimer       = null;   // debounce timer handle
  let _tokenClient     = null;   // GIS token client instance
  let _statusCbs       = [];     // status-change subscribers
  let _status          = 'idle'; // current status string

  // ── Helper: Get active Client ID ─────────────────────────────────────────
  function getClientId() {
    const custom = (localStorage.getItem('memoire_oauth_client_id') || '').trim();
    if (custom && custom !== 'undefined' && custom !== 'null' && custom.length > 5) return custom;
    const fetched = (_fetchedClientId || '').trim();
    if (fetched && fetched !== 'undefined' && fetched !== 'null' && fetched.length > 5) return fetched;
    return DEFAULT_CLIENT_ID;
  }

  function setClientId(id) {
    if (id && id.trim() && id.trim() !== 'undefined' && id.trim() !== 'null') {
      localStorage.setItem('memoire_oauth_client_id', id.trim());
    } else {
      localStorage.removeItem('memoire_oauth_client_id');
    }
  }

  // ── Status management ──────────────────────────────────────────────────────
  function setStatus(status, detail) {
    _status = status;
    _statusCbs.forEach(fn => fn(status, detail || ''));
  }

  function onStatusChange(fn) {
    _statusCbs.push(fn);
  }

  function waitForGoogleIdentityServices(timeoutMs = 5000) {
    if (window.google?.accounts?.oauth2) return Promise.resolve(true);

    return new Promise(resolve => {
      const startedAt = Date.now();
      const check = () => {
        if (window.google?.accounts?.oauth2) {
          resolve(true);
        } else if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  // ── Initialise ─────────────────────────────────────────────────────────────
  async function init() {
    // Attempt to fetch Client ID dynamically from backend environment config
    try {
      const apiBase = (typeof API_BASE !== 'undefined') ? API_BASE : 'http://localhost:3001';
      const res = await fetch(`${apiBase}/auth/config`);
      if (res.ok) {
        const data = await res.json();
        if (data.clientId) {
          _fetchedClientId = data.clientId;
        }
      }
    } catch (e) {
      // Backend offline or unreachable — fallback to default Client ID
    }

    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved) {
      _token = saved;
      setStatus('signed-in', 'Connected to Google Drive');
      ensureDriveFolder().catch(() => {});
    } else {
      setStatus('idle', 'Ready to connect');
    }
  }

  // ── Build GIS token client ──────────────────────────────────────────────────
  function _buildTokenClient(clientId, onSuccess) {
    if (!window.google?.accounts?.oauth2) return null;
    return google.accounts.oauth2.initTokenClient({
      client_id : clientId,
      scope     : SCOPE,
      callback  : async (resp) => {
        if (resp.error) {
          setStatus('error', `OAuth Error: ${resp.error_description || resp.error}`);
          return;
        }
        _token = resp.access_token;
        sessionStorage.setItem(TOKEN_KEY, _token);
        setStatus('signed-in', 'Connected to Google Drive');
        try {
          await ensureDriveFolder();
        } catch (e) {
          console.warn('Could not auto-create folder:', e);
        }
        if (onSuccess) await onSuccess();
      },
    });
  }

  // ── Sign In ────────────────────────────────────────────────────────────────
  async function signIn(afterSignIn) {
    let clientId = getClientId();
    if (!clientId || clientId.trim().length < 5) {
      setStatus('error', 'OAuth Client ID not configured');
      return false;
    }

    setStatus('signing-in', 'Loading Google Sign-In...');
    if (!await waitForGoogleIdentityServices()) {
      setStatus('error', 'Google Identity Services could not be loaded. Check your network or content-security policy.');
      return false;
    }

    setStatus('signing-in', 'Opening Google Sign-In...');
    _tokenClient = _buildTokenClient(clientId, afterSignIn);
    if (!_tokenClient) {
      setStatus('error', 'Failed to initialize Google Sign-In client');
      return false;
    }
    _tokenClient.requestAccessToken({ prompt: '' });
    return true;
  }

  // ── Sign Out ───────────────────────────────────────────────────────────────
  function signOut() {
    if (_token && window.google?.accounts?.oauth2) {
      try { google.accounts.oauth2.revoke(_token, () => {}); } catch(e){}
    }
    _token        = null;
    _driveFileId  = null;
    _userFolderId = null;
    _sharedFolderId = null;
    _tokenClient  = null;
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem('memoire_gis_token');
    setStatus('signed-out', 'Disconnected');
  }

  // ── Drive REST helper ─────────────────────────────────────────────────────
  async function _fetch(method, url, body, extraHeaders) {
    if (!_token) throw new Error('Not signed into Google Drive');
    const resp = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${_token}`, ...extraHeaders },
      body,
    });
    if (resp.status === 401) {
      _token = null;
      sessionStorage.removeItem(TOKEN_KEY);
      setStatus('signed-out', 'Session expired — please sign in again');
      throw new Error('Token expired');
    }
    return resp;
  }

  // ── Create/Find 'Mémoire Shared Photos' Folder in Drive ─────────────────────
  async function ensureDriveFolder() {
    if (!_token) return null;
    if (_userFolderId) return _userFolderId;

    try {
      const q = encodeURIComponent(`name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
      const res = await _fetch('GET', `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1`);
      const data = await res.json();

      if (data.files && data.files.length > 0) {
        _userFolderId = data.files[0].id;
        return _userFolderId;
      }

      // Folder doesn't exist, create it in user's Drive root
      const createRes = await _fetch('POST',
        'https://www.googleapis.com/drive/v3/files?fields=id',
        JSON.stringify({
          name: FOLDER_NAME,
          mimeType: 'application/vnd.google-apps.folder'
        }),
        { 'Content-Type': MIME_JSON }
      );
      const folderData = await createRes.json();
      _userFolderId = folderData.id;
      return _userFolderId;
    } catch (err) {
      console.error('Failed to find or create Drive folder:', err);
      throw err;
    }
  }

  // ── Convert DataURL to Blob helper ──────────────────────────────────────────
  function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  // ── Upload Photo & Caption to User's Google Drive Folder ────────────────────
  async function uploadPhotoToDrive(photoDataUrlOrBlob, filename, caption = '') {
    if (!_token) throw new Error('Google Drive not connected');
    const folderId = await ensureDriveFolder();

    let imageBlob;
    if (typeof photoDataUrlOrBlob === 'string') {
      imageBlob = dataURLtoBlob(photoDataUrlOrBlob);
    } else {
      imageBlob = photoDataUrlOrBlob;
    }

    const cleanFilename = filename || `photo_${Date.now()}.jpg`;

    const metadata = {
      name: cleanFilename,
      parents: [folderId],
      description: caption || ''
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: MIME_JSON }));
    form.append('file', imageBlob);

    setStatus('syncing', `Uploading ${cleanFilename} to Google Drive...`);

    const res = await _fetch('POST',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,webContentLink,thumbnailLink,description',
      form
    );

    const driveFile = await res.json();
    setStatus('signed-in', 'Photo saved to Google Drive ☁️');

    return {
      driveFileId: driveFile.id,
      name: driveFile.name,
      caption: driveFile.description || caption,
      webViewLink: driveFile.webViewLink,
      webContentLink: driveFile.webContentLink,
      thumbnailLink: driveFile.thumbnailLink
    };
  }

  function setSharedFolder(folderId) {
    _sharedFolderId = folderId || null;
  }

  async function createSharedFolder(name) {
    if (!_token) throw new Error('Connect Google Drive before creating a shared space');

    const createRes = await _fetch(
      'POST',
      'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name,webViewLink',
      JSON.stringify({ name: name || 'Mémoire Shared Space', mimeType: 'application/vnd.google-apps.folder' }),
      { 'Content-Type': MIME_JSON }
    );
    if (!createRes.ok) throw new Error('Google Drive could not create the shared folder');
    const folder = await createRes.json();
    _sharedFolderId = folder.id;

    const permissionRes = await _fetch(
      'POST',
      `https://www.googleapis.com/drive/v3/files/${folder.id}/permissions?supportsAllDrives=true&sendNotificationEmail=false`,
      JSON.stringify({ type: 'anyone', role: 'writer' }),
      { 'Content-Type': MIME_JSON }
    );
    if (!permissionRes.ok) {
      setStatus('signed-in', 'Folder created; share it from Google Drive before inviting contributors');
    }

    return { ...folder, folderId: folder.id };
  }

  async function uploadPhotoToFolder(folderId, photoDataUrlOrBlob, filename, caption = '') {
    if (!_token) throw new Error('Connect Google Drive before uploading');
    if (!folderId) throw new Error('Shared Drive folder is not configured');

    const imageBlob = typeof photoDataUrlOrBlob === 'string'
      ? dataURLtoBlob(photoDataUrlOrBlob)
      : photoDataUrlOrBlob;
    const metadata = {
      name: filename || `photo_${Date.now()}.jpg`,
      parents: [folderId],
      description: caption || ''
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: MIME_JSON }));
    form.append('file', imageBlob);
    const res = await _fetch(
      'POST',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,description,createdTime,webViewLink',
      form
    );
    if (!res.ok) throw new Error('Google Drive rejected the photo upload');
    return res.json();
  }

  async function deleteDriveFile(fileId) {
    if (!_token || !fileId) return;
    const res = await _fetch('DELETE', `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`);
    if (!res.ok && res.status !== 404) throw new Error('Google Drive could not delete the photo');
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function downloadDriveImage(fileId) {
    const res = await _fetch('GET', `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`);
    if (!res.ok) throw new Error('Google Drive could not load the photo');
    return blobToDataUrl(await res.blob());
  }

  // ── Fetch Photos & Captions from Google Drive Folder ────────────────────────
  async function fetchFolderPhotos(folderId = _userFolderId) {
    if (!_token) return [];
    const activeFolderId = folderId || await ensureDriveFolder();
    setStatus('syncing', 'Fetching photos from Google Drive folder...');

    try {
      const q = encodeURIComponent(`'${activeFolderId}' in parents and mimeType contains 'image/' and trashed=false`);
      const res = await _fetch('GET',
        `https://www.googleapis.com/drive/v3/files?q=${q}&supportsAllDrives=true&includeItemsFromAllDrives=true&fields=files(id,name,description,mimeType,thumbnailLink,webContentLink,webViewLink,createdTime)&pageSize=100&orderBy=createdTime desc`
      );
      if (!res.ok) throw new Error('Google Drive could not list this shared folder');
      const data = await res.json();
      const files = data.files || [];

      setStatus('signed-in', `Retrieved ${files.length} photo(s) from Drive`);

      return Promise.all(files.map(async file => ({
          id: `drive_${file.id}`,
          driveFileId: file.id,
          filename: file.name,
          caption: file.description || '',
          dataUrl: await downloadDriveImage(file.id),
          thumbnailLink: file.thumbnailLink,
          webViewLink: file.webViewLink,
          addedAt: new Date(file.createdTime).getTime(),
          source: 'google_drive'
        })));
    } catch (err) {
      console.error('Fetch Drive folder photos failed:', err);
      setStatus('error', `Drive fetch error: ${err.message}`);
      return [];
    }
  }

  // ── Update Caption on Google Drive File ────────────────────────────────────
  async function updateDrivePhotoCaption(driveFileId, caption) {
    if (!_token || !driveFileId) return;
    try {
      await _fetch('PATCH',
        `https://www.googleapis.com/drive/v3/files/${driveFileId}`,
        JSON.stringify({ description: caption }),
        { 'Content-Type': MIME_JSON }
      );
    } catch (err) {
      console.warn('Failed to update caption in Drive:', err);
    }
  }

  // ── Find appDataFolder file (for session JSON) ──────────────────────────────
  async function _findFile() {
    if (_driveFileId) return _driveFileId;
    const q   = encodeURIComponent(`name='${FILENAME}' and trashed=false`);
    const res = await _fetch('GET',
      `https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)&pageSize=1`
    );
    const data = await res.json();
    _driveFileId = data.files?.[0]?.id || null;
    return _driveFileId;
  }

  // ── Load session from Drive appDataFolder ──────────────────────────────────
  async function loadFromDrive() {
    if (!_token) return null;
    setStatus('syncing', 'Loading session from Drive...');
    try {
      const fid = await _findFile();
      if (!fid) {
        setStatus('signed-in', 'Connected to Google Drive');
        return null;
      }
      const res     = await _fetch('GET',
        `https://www.googleapis.com/drive/v3/files/${fid}?alt=media`
      );
      const session = await res.json();
      const n       = session.photos?.length || 0;
      setStatus('signed-in', `Loaded ${n} memory session item(s) from Drive`);
      return session;
    } catch (err) {
      setStatus('error', `Load failed: ${err.message}`);
      return null;
    }
  }

  // ── Save session to Drive appDataFolder ────────────────────────────────────
  async function _saveToDrive(session) {
    if (!_token) return;
    setStatus('syncing', 'Saving session...');
    try {
      const body = JSON.stringify(session);
      const fid  = await _findFile();

      if (fid) {
        await _fetch('PATCH',
          `https://www.googleapis.com/upload/drive/v3/files/${fid}?uploadType=media`,
          body,
          { 'Content-Type': MIME_JSON }
        );
      } else {
        const meta = { name: FILENAME, parents: ['appDataFolder'] };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(meta)], { type: MIME_JSON }));
        form.append('file',     new Blob([body],                  { type: MIME_JSON }));
        const res  = await _fetch('POST',
          'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
          form
        );
        const data    = await res.json();
        _driveFileId  = data.id;
      }

      const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setStatus('signed-in', `Synced at ${t}`);
    } catch (err) {
      setStatus('error', `Save failed: ${err.message}`);
    }
  }

  // ── Scheduled (debounced) save ─────────────────────────────────────────────
  function scheduleSave(getSessionFn) {
    if (!_token) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(() => _saveToDrive(getSessionFn()), SAVE_DEBOUNCE_MS);
  }

  // ── Size helper ────────────────────────────────────────────────────────────
  function estimateSizeMB(session) {
    const raw = JSON.stringify(session);
    return (new Blob([raw]).size / 1024 / 1024).toFixed(1);
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  return {
    init,
    signIn,
    signOut,
    loadFromDrive,
    scheduleSave,
    onStatusChange,
    estimateSizeMB,
    ensureDriveFolder,
    uploadPhotoToDrive,
    createSharedFolder,
    setSharedFolder,
    uploadPhotoToFolder,
    deleteDriveFile,
    fetchFolderPhotos,
    updateDrivePhotoCaption,
    getClientId,
    setClientId,
    get isSignedIn() { return !!_token; },
    get status()     { return _status; },
    get folderId()   { return _userFolderId; }
  };

})();
