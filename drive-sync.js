/**
 * drive-sync.js — Google Drive appDataFolder Session Sync
 *
 * Saves/loads the Mémoire session (photos + captions) to a hidden
 * `memoire-session.json` file in the user's Google Drive appDataFolder
 * (private to this app, not visible in normal Drive UI).
 *
 * Uses Google Identity Services (GIS) token model — no redirect, just a popup.
 * Requires: <script src="https://accounts.google.com/gsi/client" async defer>
 */

const DriveSync = (() => {

  // ── Constants ──────────────────────────────────────────────────────────────
  const SCOPE     = 'https://www.googleapis.com/auth/drive.appdata';
  const FILENAME  = 'memoire-session.json';
  const MIME_JSON = 'application/json';
  const SAVE_DEBOUNCE_MS = 3000; // wait 3s after last change before saving

  // ── State ──────────────────────────────────────────────────────────────────
  let _token       = null;   // current OAuth access token
  let _driveFileId = null;   // cached Drive file ID for memoire-session.json
  let _saveTimer   = null;   // debounce timer handle
  let _tokenClient = null;   // GIS token client instance
  let _statusCbs   = [];     // status-change subscribers
  let _status      = 'idle'; // current status string

  // ── Status management ──────────────────────────────────────────────────────
  function setStatus(status, detail) {
    _status = status;
    _statusCbs.forEach(fn => fn(status, detail || ''));
  }

  function onStatusChange(fn) {
    _statusCbs.push(fn);
  }

  // ── Initialise ─────────────────────────────────────────────────────────────
  function init() {
    // Restore a previously issued token from sessionStorage (same tab session)
    const saved = sessionStorage.getItem('memoire_gis_token');
    if (saved) {
      _token = saved;
      setStatus('signed-in', 'Restored session');
    } else {
      setStatus('idle');
    }
  }

  // ── Build / get the GIS token client ──────────────────────────────────────
  function _buildTokenClient(clientId, onSuccess) {
    if (!window.google?.accounts?.oauth2) return null;
    return google.accounts.oauth2.initTokenClient({
      client_id : clientId,
      scope     : SCOPE,
      callback  : async (resp) => {
        if (resp.error) {
          setStatus('error', resp.error_description || resp.error);
          return;
        }
        _token = resp.access_token;
        sessionStorage.setItem('memoire_gis_token', _token);
        setStatus('signed-in', 'Signed in');
        if (onSuccess) await onSuccess();
      },
    });
  }

  // ── Sign In ────────────────────────────────────────────────────────────────
  function signIn(afterSignIn) {
    const clientId = (localStorage.getItem('memoire_oauth_client_id') || '').trim();
    if (!clientId) {
      setStatus('error', 'OAuth Client ID not set');
      return false; // caller should open the config UI
    }

    if (!window.google?.accounts?.oauth2) {
      setStatus('error', 'GIS library not loaded yet — try again in a moment');
      return false;
    }

    setStatus('signing-in', 'Opening sign-in…');
    _tokenClient = _buildTokenClient(clientId, afterSignIn);
    // '' = use previously granted consent silently; 'consent' = show chooser
    _tokenClient.requestAccessToken({ prompt: '' });
    return true;
  }

  // ── Sign Out ───────────────────────────────────────────────────────────────
  function signOut() {
    if (_token && window.google?.accounts?.oauth2) {
      google.accounts.oauth2.revoke(_token, () => {});
    }
    _token       = null;
    _driveFileId = null;
    _tokenClient = null;
    sessionStorage.removeItem('memoire_gis_token');
    setStatus('signed-out', 'Signed out');
  }

  // ── Drive REST helpers ─────────────────────────────────────────────────────
  async function _fetch(method, url, body, extraHeaders) {
    if (!_token) throw new Error('Not signed in');
    const resp = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${_token}`, ...extraHeaders },
      body,
    });
    if (resp.status === 401) {
      // Token expired
      _token = null;
      sessionStorage.removeItem('memoire_gis_token');
      setStatus('signed-out', 'Session expired — please sign in again');
      throw new Error('Token expired');
    }
    return resp;
  }

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

  // ── Load from Drive ────────────────────────────────────────────────────────
  async function loadFromDrive() {
    if (!_token) return null;
    setStatus('syncing', 'Loading from Drive…');
    try {
      const fid = await _findFile();
      if (!fid) {
        setStatus('signed-in', 'No cloud session yet');
        return null;
      }
      const res     = await _fetch('GET',
        `https://www.googleapis.com/drive/v3/files/${fid}?alt=media`
      );
      const session = await res.json();
      const n       = session.photos?.length || 0;
      setStatus('signed-in', `Loaded ${n} memor${n === 1 ? 'y' : 'ies'} from Drive`);
      return session;
    } catch (err) {
      setStatus('error', `Load failed: ${err.message}`);
      return null;
    }
  }

  // ── Save to Drive ──────────────────────────────────────────────────────────
  async function _saveToDrive(session) {
    if (!_token) return;
    setStatus('syncing', 'Saving…');
    try {
      const body = JSON.stringify(session);
      const fid  = await _findFile();

      if (fid) {
        // PATCH — update existing file content
        await _fetch('PATCH',
          `https://www.googleapis.com/upload/drive/v3/files/${fid}?uploadType=media`,
          body,
          { 'Content-Type': MIME_JSON }
        );
      } else {
        // POST — create new file in appDataFolder
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
    get isSignedIn() { return !!_token; },
    get status()     { return _status; },
  };

})();
