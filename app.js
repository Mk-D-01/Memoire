/**
 * app.js — Main Application Logic (Optimised v2)
 * Handles: file upload, drag & drop, lightbox, layout switching,
 *          captions, IndexedDB + localStorage persistence,
 *          sessionStorage progress restore, toasts,
 *          touch swipe in lightbox, and Google Drive import.
 */

// ─── Constants ────────────────────────────────────────────────────────────────
const LS_SESSION_KEY  = 'memoire_session';   // sessionStorage
const LS_META_KEY     = 'memoire_meta';      // localStorage  (metadata only)
const LS_API_KEY      = 'memoire_drive_api_key';
const IDB_NAME        = 'memoireDB';
const IDB_VERSION     = 1;
const IDB_STORE       = 'photos';
const MAX_DIMENSION   = 1600;                // px — compress larger images
const IMG_QUALITY     = 0.88;

// ─── State ────────────────────────────────────────────────────────────────────
let photos        = [];   // { id, dataUrl, caption, addedAt, source? }
let currentIndex  = 0;
let currentLayout = 'masonry';
let dragCounter   = 0;
let idbDb         = null;   // IndexedDB connection
let saveTimer     = null;   // debounce handle

// ─── DOM Elements ─────────────────────────────────────────────────────────────
const fileInput       = document.getElementById('fileInput');
const collageGrid     = document.getElementById('collageGrid');
const collageWrapper  = document.getElementById('collageWrapper');
const emptyState      = document.getElementById('emptyState');
const statsBar        = document.getElementById('statsBar');
const photoCount      = document.getElementById('photoCount');
const dropOverlay     = document.getElementById('dropOverlay');
const lightbox        = document.getElementById('lightbox');
const lightboxImg     = document.getElementById('lightboxImg');
const lightboxCaption = document.getElementById('lightboxCaption');
const lightboxDate    = document.getElementById('lightboxDate');
const lightboxClose   = document.getElementById('lightboxClose');
const lightboxPrev    = document.getElementById('lightboxPrev');
const lightboxNext    = document.getElementById('lightboxNext');
const btnClearAll     = document.getElementById('btnClearAll');
const btnShuffle      = document.getElementById('btnShuffle');
const btnViewCaptions = document.getElementById('btnViewCaptions');
const toastContainer  = document.getElementById('toastContainer');
// Drive
const btnDriveImport     = document.getElementById('btnDriveImport');
const driveModal         = document.getElementById('driveModal');
const driveModalClose    = document.getElementById('driveModalClose');
const driveModalCancel   = document.getElementById('driveModalCancel');
const driveUrlInput      = document.getElementById('driveUrlInput');
const driveImportBtn     = document.getElementById('driveImportBtn');
const driveStatus        = document.getElementById('driveStatus');
const emptyDriveBtn      = document.getElementById('emptyDriveBtn');
const driveApiKeySection = document.getElementById('driveApiKeySection');
const driveApiKeyToggle  = document.getElementById('driveApiKeyToggle');
const driveApiKeyInput   = document.getElementById('driveApiKeyInput');
const driveApiKeySave    = document.getElementById('driveApiKeySave');
const apiKeyBadge        = document.getElementById('apiKeyBadge');
const driveDetectBar     = document.getElementById('driveDetectBar');
// Captions modal & Suggest & Download
const captionsModal       = document.getElementById('captionsModal');
const captionsModalClose  = document.getElementById('captionsModalClose');
const captionsList        = document.getElementById('captionsList');
const captionsSearchInput = document.getElementById('captionsSearchInput');
const captionsStats       = document.getElementById('captionsStats');
const btnAutoCaptionAll   = document.getElementById('btnAutoCaptionAll');
const lightboxSuggestBtn  = document.getElementById('lightboxSuggestBtn');
const lightboxDownloadBtn = document.getElementById('lightboxDownloadBtn');

// ─── Bootstrap ────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  // 1 — Restore layout from session (instant, synchronous)
  restoreSession();

  // 2 — Open IndexedDB, then load photos
  try {
    idbDb = await openIDB();
    await loadFromIDB();
  } catch (e) {
    // Fallback to localStorage if IDB unavailable
    loadFromLocalStorage();
  }

  renderUI();
  bindEvents();
  initDriveUI();

  // 3 — Defer ambient particles until browser is idle
  if ('requestIdleCallback' in window) {
    requestIdleCallback(spawnAmbientParticles, { timeout: 2000 });
  } else {
    setTimeout(spawnAmbientParticles, 500);
  }

  // 4 — Save session on tab hide / unload
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveSession();
  });
  window.addEventListener('pagehide', saveSession);
});

// ══════════════════════════════════════════════════════════════════════════════
// SESSION STORAGE  (tab-level fast restore)
// ══════════════════════════════════════════════════════════════════════════════

function saveSession() {
  try {
    sessionStorage.setItem(LS_SESSION_KEY, JSON.stringify({
      layout     : currentLayout,
      scrollY    : window.scrollY,
      photoIds   : photos.map(p => p.id),
      lastUpdated: Date.now(),
    }));
  } catch (e) { /* ignore */ }
}

function restoreSession() {
  try {
    const raw = sessionStorage.getItem(LS_SESSION_KEY);
    if (!raw) return;
    const sess = JSON.parse(raw);
    currentLayout = 'masonry';
    // Restore scroll after first paint
    if (sess.scrollY > 0) {
      requestAnimationFrame(() => window.scrollTo(0, sess.scrollY));
    }
  } catch (e) { /* ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// INDEXEDDB
// ══════════════════════════════════════════════════════════════════════════════

function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

function idbPut(record) {
  return new Promise((resolve, reject) => {
    const tx  = idbDb.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).put(record);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

function idbDelete(id) {
  return new Promise((resolve, reject) => {
    const tx  = idbDb.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

function idbGetAll() {
  return new Promise((resolve, reject) => {
    const tx  = idbDb.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).getAll();
    req.onsuccess = e => resolve(e.target.result || []);
    req.onerror   = e => reject(e.target.error);
  });
}

function idbClear() {
  return new Promise((resolve, reject) => {
    const tx  = idbDb.transaction(IDB_STORE, 'readwrite');
    const req = tx.objectStore(IDB_STORE).clear();
    req.onsuccess = () => resolve();
    req.onerror   = e => reject(e.target.error);
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// STORAGE — SAVE / LOAD
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Debounced save — batches rapid consecutive calls into one write.
 */
function saveToStorage() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(_doSave, 250);
}

async function _doSave() {
  // Save metadata to localStorage (fast, synchronous access on next load)
  try {
    const meta = photos.map(p => ({
      id: p.id, caption: p.caption, addedAt: p.addedAt, source: p.source,
    }));
    localStorage.setItem(LS_META_KEY, JSON.stringify(meta));
  } catch (e) { /* ignore */ }

  // Save full records (including dataUrl) to IndexedDB
  if (idbDb) {
    // Use a single transaction for batch efficiency
    try {
      const tx    = idbDb.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      for (const p of photos) {
        store.put({ id: p.id, dataUrl: p.dataUrl, caption: p.caption, addedAt: p.addedAt, source: p.source });
      }
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; });
    } catch (e) { /* ignore */ }
  } else {
    // Fallback: localStorage direct (may hit quota for large images)
    saveToLocalStorage();
  }

  // Update session snapshot too
  saveSession();
}

async function loadFromIDB() {
  const records = await idbGetAll();
  if (records.length > 0) {
    photos = records;
    const sess = (() => {
      try { return JSON.parse(sessionStorage.getItem(LS_SESSION_KEY)); } catch { return null; }
    })();
    if (sess && sess.photoIds && sess.photoIds.length > 0 && records.length > 0) {
      showToast(`✦ Session restored — ${records.length} ${records.length === 1 ? 'memory' : 'memories'}`, 2000);
    }
  } else {
    // Try migrating from old localStorage format
    loadFromLocalStorage();
    if (photos.length > 0 && idbDb) {
      // Migrate silently
      _doSave();
    }
  }
}

// Fallback / migration: old localStorage schema
function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem('memoire_photos') || localStorage.getItem(LS_META_KEY);
    if (raw) photos = JSON.parse(raw);
  } catch (e) { photos = []; }
}

function saveToLocalStorage() {
  try {
    localStorage.setItem('memoire_photos', JSON.stringify(
      photos.map(p => ({ id: p.id, dataUrl: p.dataUrl, caption: p.caption, addedAt: p.addedAt }))
    ));
  } catch (e) { /* quota exceeded — ignore */ }
}

// ══════════════════════════════════════════════════════════════════════════════
// IMAGE COMPRESSION
// ══════════════════════════════════════════════════════════════════════════════

/**
 * Compress an image File to a dataURL.
 * Resizes so the longest side ≤ MAX_DIMENSION.
 */
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = e => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { naturalWidth: w, naturalHeight: h } = img;
        if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
          if (w >= h) { h = Math.round(h * MAX_DIMENSION / w); w = MAX_DIMENSION; }
          else        { w = Math.round(w * MAX_DIMENSION / h); h = MAX_DIMENSION; }
        }
        const canvas = document.createElement('canvas');
        canvas.width  = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', IMG_QUALITY));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── Render ───────────────────────────────────────────────────────────────────
function renderUI() {
  const hasPhotos = photos.length > 0;
  emptyState.classList.toggle('visible', !hasPhotos);
  statsBar.classList.toggle('visible', hasPhotos);
  collageWrapper.style.display = hasPhotos ? '' : 'none';
  if (hasPhotos) {
    photoCount.textContent = `${photos.length} ${photos.length === 1 ? 'memory' : 'memories'}`;
    renderCollage(photos, collageGrid, 'masonry');
    bindCardEvents();
  }
}

// ─── Auto-Caption & Memory Quotes Engine ──────────────────────────────────────
const MEMORY_QUOTES = [
  "Little pockets of peace ✨",
  "Sunlit daydream",
  "Forever etched in light",
  "Laughter trapped in amber",
  "The poetry of ordinary days",
  "A sweet slice of life",
  "Chasing golden horizons",
  "Soft whispers of time",
  "Where the heart wanders",
  "Captured in a fleeting second 🌸",
  "Golden hour & good vibes",
  "Wild hearts & quiet moments",
  "Collecting moments, not things",
  "Somewhere between dream & dusk",
  "In the warm embrace of memory",
  "Sun-kissed & unforgettable",
  "A tiny piece of eternity",
  "Wander often, wonder always 💫",
  "Lost in the beauty of now",
  "Magic in the stillness",
  "A gentle pause in time",
  "Vintage soul, modern light",
  "Wrapped in warm sunshine",
  "Echoes of happy laughter",
  "Moments that make you smile",
  "Pure bliss & simple joys",
  "A chapter to remember ✨",
  "Treasured little things",
  "Stars in our eyes",
  "Dancing through the breeze 🍃",
  "A heartbeat caught on film",
  "Radiant like afternoon light",
  "Unwritten stories & quiet roads",
  "The art of living slowly",
  "Sunsets and fond memories",
  "Glimpses of wonder ✨"
];

const ATMOSPHERIC_DESCRIPTIONS = [
  "Golden hour tranquility",
  "Summer glow & gentle breezes",
  "Morning haze & quiet dreams",
  "Starlit evening stillness",
  "Ocean breeze & sun-warmed sand",
  "Mountain air & open skies",
  "Coffee aroma & slow mornings",
  "Soft shadows & warm light",
  "City lights & twilight wandering",
  "Cozy moments in the sun"
];

function formatCleanFilename(name) {
  if (!name) return '';
  let clean = name.replace(/\.[^.]+$/, '');
  // Skip generic camera/download/hash names
  if (/^(img|pxl|dsc|dscn|photo|image|scan|screenshot|pic|download|file)[_-]?\d*$/i.test(clean)) return '';
  if (/^[0-9a-f]{8,}(-[0-9a-f]{4,})*$/i.test(clean)) return '';
  clean = clean.replace(/[_\-.]+/g, ' ').trim();
  clean = clean.split(' ').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return clean.length > 2 && clean.length < 50 ? clean : '';
}

function generateAutoCaption(fileOrName = '', timestamp = Date.now()) {
  const nameStr = typeof fileOrName === 'string' ? fileOrName : fileOrName?.name || '';
  const clean = formatCleanFilename(nameStr);
  if (clean) return clean;

  const date = new Date(timestamp || Date.now());
  const month = date.toLocaleDateString('en-US', { month: 'short' });
  const year = date.getFullYear();
  const day = date.getDate();

  const choice = Math.random();
  if (choice < 0.45) {
    return MEMORY_QUOTES[Math.floor(Math.random() * MEMORY_QUOTES.length)];
  } else if (choice < 0.75) {
    return ATMOSPHERIC_DESCRIPTIONS[Math.floor(Math.random() * ATMOSPHERIC_DESCRIPTIONS.length)];
  } else {
    const dateStyles = [
      `Captured in ${month} ${year}`,
      `${month} ${day}, ${year}`,
      `Moments from ${month} '${String(year).slice(2)}`,
      `Treasured · ${month} ${year}`,
      `A glimpse of ${month} ${year} ✨`
    ];
    return dateStyles[Math.floor(Math.random() * dateStyles.length)];
  }
}

function getRandomQuote() {
  const all = [...MEMORY_QUOTES, ...ATMOSPHERIC_DESCRIPTIONS];
  return all[Math.floor(Math.random() * all.length)];
}

function suggestCaptionForActivePhoto() {
  if (!photos[currentIndex]) return;
  const quote = getRandomQuote();
  lightboxCaption.value = quote;
  photos[currentIndex].caption = quote;
  saveToStorage();

  const card = collageGrid.querySelector(`[data-id="${photos[currentIndex].id}"]`);
  if (card) {
    const bar = card.querySelector('.photo-card-caption-bar');
    if (bar) {
      const captionEl = bar.querySelector('.card-caption');
      if (captionEl) captionEl.textContent = quote;
      delete bar.dataset.empty;
    }
    const overlayCaption = card.querySelector('.overlay-caption');
    if (overlayCaption) overlayCaption.textContent = quote;
    const labelEl = card.querySelector('.polaroid-label');
    if (labelEl) {
      labelEl.textContent = quote;
      labelEl.classList.remove('empty-caption');
    }
  }
  showToast('✨ Caption suggested!');
}

/**
 * Render and download an authentic high-resolution Polaroid card with photo,
 * vintage frame, handwritten cursive caption, date stamp, and index badge.
 */
async function downloadPolaroidCard(photoIndex) {
  const photo = photos[photoIndex];
  if (!photo) return;

  showToast('⏳ Generating Polaroid download…', 1400);

  const img = new Image();
  img.crossOrigin = 'anonymous';

  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = () => {
      const fallback = new Image();
      fallback.onload = resolve;
      fallback.onerror = resolve;
      fallback.src = photo.dataUrl;
    };
    img.src = photo.dataUrl;
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  const photoW = img.naturalWidth || img.width || 800;
  const photoH = img.naturalHeight || img.height || 600;

  // Authentic Polaroid proportions
  const borderX = Math.max(24, Math.round(photoW * 0.05));
  const borderTop = Math.max(24, Math.round(photoW * 0.05));
  const chinBottom = Math.max(90, Math.round(photoW * 0.18));

  const canvasW = photoW + borderX * 2;
  const canvasH = photoH + borderTop + chinBottom;

  canvas.width = canvasW;
  canvas.height = canvasH;

  // 1. Vintage polaroid paper background
  const paperGrad = ctx.createLinearGradient(0, 0, 0, canvasH);
  paperGrad.addColorStop(0, '#fefdfa');
  paperGrad.addColorStop(1, '#f6f3eb');
  ctx.fillStyle = paperGrad;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // 2. Subtle outer border
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.07)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvasW - 2, canvasH - 2);

  // 3. Photo drawing
  ctx.drawImage(img, borderX, borderTop, photoW, photoH);

  // 4. Inner photo border
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
  ctx.lineWidth = 1;
  ctx.strokeRect(borderX, borderTop, photoW, photoH);

  // 5. Handwritten cursive caption
  const captionText = photo.caption || `Memory #${photoIndex + 1}`;
  const fontSize = Math.max(24, Math.round(photoW * 0.048));
  ctx.font = `600 ${fontSize}px "Dancing Script", cursive, "Playfair Display", serif`;
  ctx.fillStyle = '#2b2538';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const captionY = photoH + borderTop + (chinBottom * 0.42);
  ctx.fillText(captionText, canvasW / 2, captionY, photoW - 20);

  // 6. Date stamp & index badge subline
  const dateText = formatDate(photo.addedAt || Date.now()).toUpperCase();
  const badgeText = `#${String(photoIndex + 1).padStart(2, '0')}`;
  const metaFontSize = Math.max(12, Math.round(fontSize * 0.42));
  ctx.font = `600 ${metaFontSize}px "Inter", system-ui, sans-serif`;
  ctx.fillStyle = '#8c839f';

  const metaY = photoH + borderTop + (chinBottom * 0.78);
  ctx.textAlign = 'left';
  ctx.fillText(dateText, borderX + 4, metaY);

  ctx.textAlign = 'right';
  ctx.fillText(badgeText, canvasW - borderX - 4, metaY);

  // 7. Trigger download
  try {
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    const safeTitle = (photo.caption || `memory-${photoIndex + 1}`)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'memory';
    link.download = `memoire-polaroid-${safeTitle}.png`;
    link.href = dataUrl;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('✅ Polaroid downloaded!');
  } catch (e) {
    showToast('⚠ Download error');
  }
}

function autoCaptionEmptyMemories() {
  if (!photos.length) { showToast('⚠ No memories to caption'); return; }
  let count = 0;
  photos.forEach((photo, idx) => {
    if (!photo.caption || photo.caption.startsWith('Memory #')) {
      photo.caption = generateAutoCaption('', photo.addedAt || Date.now());
      count++;
    }
  });

  if (count > 0) {
    saveToStorage();
    renderUI();
    renderCaptionsList(captionsSearchInput.value);
    showToast(`✨ Auto-captioned ${count} ${count === 1 ? 'memory' : 'memories'}!`);
  } else {
    showToast('✦ All memories already have captions!');
  }
}

// ─── File Handling ────────────────────────────────────────────────────────────
async function processFiles(files) {
  const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!imageFiles.length) { showToast('⚠ No image files found'); return; }

  showToast(`⏳ Processing ${imageFiles.length} image${imageFiles.length > 1 ? 's' : ''}…`, 1500);

  const results = await Promise.allSettled(imageFiles.map(compressImage));
  let loaded = 0;

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      const file = imageFiles[i];
      photos.push({
        id     : `photo_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        dataUrl: result.value,
        caption: generateAutoCaption(file, Date.now()),
        addedAt: Date.now(),
      });
      loaded++;
    }
  });

  if (loaded > 0) {
    // If connected to Google Drive, auto-upload to user's 'Mémoire Shared Photos' folder
    if (typeof DriveSync !== 'undefined' && DriveSync.isSignedIn) {
      const newlyAdded = photos.slice(-loaded);
      for (const item of newlyAdded) {
        DriveSync.uploadPhotoToDrive(item.dataUrl, item.caption || 'memory.jpg', item.caption)
          .then(driveRes => {
            item.driveFileId = driveRes.driveFileId;
            item.webViewLink = driveRes.webViewLink;
            saveToStorage();
          })
          .catch(err => console.warn('Drive auto-upload error:', err));
      }
    }

    if (typeof CollabEngine !== 'undefined' && CollabEngine.state.isCollaborative) {
      const newItems = photos.slice(-loaded);
      CollabEngine.uploadLobbyPhotos(newItems.map(p => ({
        dataUrl: p.dataUrl,
        filename: p.caption || 'memory.jpg',
        caption: p.caption,
        size: p.dataUrl.length
      })));
    } else {
      saveToStorage();
      renderUI();
    }
    showToast(`✦ ${loaded} ${loaded === 1 ? 'memory' : 'memories'} added!`);
  }
}

// ─── Bind Global Events ───────────────────────────────────────────────────────
function bindEvents() {
  fileInput.addEventListener('change', e => {
    processFiles(e.target.files);
    fileInput.value = '';
  });

  // Use passive listeners for drag — prevents scroll jank on Android
  window.addEventListener('dragenter', e => {
    e.preventDefault();
    dragCounter++;
    dropOverlay.classList.add('active');
  });
  window.addEventListener('dragleave', () => {
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; dropOverlay.classList.remove('active'); }
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragCounter = 0;
    dropOverlay.classList.remove('active');
    if (e.dataTransfer.files.length) processFiles(e.dataTransfer.files);
  });

  // Lightbox controls
  lightboxClose.addEventListener('click', closeLightbox);
  lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
  lightboxNext.addEventListener('click', () => navigateLightbox(1));
  lightbox.addEventListener('click', e => { if (e.target === lightbox) closeLightbox(); });

  lightboxCaption.addEventListener('blur', saveLightboxCaption);
  lightboxCaption.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); lightboxCaption.blur(); }
  });

  // Touch swipe in lightbox
  let touchStartX = 0;
  let touchStartY = 0;
  lightbox.addEventListener('touchstart', e => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  lightbox.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
      saveLightboxCaption();
      navigateLightbox(dx < 0 ? 1 : -1);
    }
  }, { passive: true });

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (lightbox.classList.contains('active')) {
      if (e.key === 'ArrowLeft')  navigateLightbox(-1);
      if (e.key === 'ArrowRight') navigateLightbox(1);
      if (e.key === 'Escape')     closeLightbox();
    }
    if (e.key === 'Escape' && driveModal.classList.contains('active')) closeDriveModal();
    if (e.key === 'Escape' && captionsModal.classList.contains('active')) closeCaptionsModal();
  });

  btnShuffle.addEventListener('click', () => {
    if (!photos.length) return;
    shuffleArray(photos);
    saveToStorage();
    renderUI();
    showToast('🔀 Memories shuffled!');
  });

  btnViewCaptions.addEventListener('click', openCaptionsModal);
  captionsModalClose.addEventListener('click', closeCaptionsModal);
  captionsModal.addEventListener('click', e => { if (e.target === captionsModal) closeCaptionsModal(); });
  captionsSearchInput.addEventListener('input', () => renderCaptionsList(captionsSearchInput.value));

  if (btnAutoCaptionAll) {
    btnAutoCaptionAll.addEventListener('click', autoCaptionEmptyMemories);
  }
  if (lightboxSuggestBtn) {
    lightboxSuggestBtn.addEventListener('click', e => {
      e.stopPropagation();
      suggestCaptionForActivePhoto();
    });
  }
  if (lightboxDownloadBtn) {
    lightboxDownloadBtn.addEventListener('click', e => {
      e.stopPropagation();
      downloadPolaroidCard(currentIndex);
    });
  }

  btnClearAll.addEventListener('click', async () => {
    if (!photos.length) return;
    if (!confirm(`Remove all ${photos.length} memories? This cannot be undone.`)) return;
    photos = [];
    if (idbDb) await idbClear();
    localStorage.removeItem(LS_META_KEY);
    localStorage.removeItem('memoire_photos');
    sessionStorage.removeItem(LS_SESSION_KEY);
    renderUI();
    showToast('🗑 All memories cleared');
  });

  // Drive modal open/close
  const openDriveModal = () => {
    driveStatus.innerHTML = '';
    driveDetectBar.innerHTML = '';
    driveUrlInput.value = '';
    driveModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => driveUrlInput.focus(), 100);
  };

  btnDriveImport.addEventListener('click', openDriveModal);
  emptyDriveBtn.addEventListener('click', openDriveModal);
  driveModalClose.addEventListener('click', closeDriveModal);
  driveModalCancel.addEventListener('click', closeDriveModal);
  driveModal.addEventListener('click', e => { if (e.target === driveModal) closeDriveModal(); });
  driveImportBtn.addEventListener('click', handleDriveImport);

  // Collaborative Lobby modal open/close
  const btnLobby = document.getElementById('btnLobby');
  const lobbyModal = document.getElementById('lobbyModal');
  const lobbyModalClose = document.getElementById('lobbyModalClose');
  if (btnLobby && typeof CollabEngine !== 'undefined') {
    btnLobby.addEventListener('click', () => CollabEngine.openLobbyModal());
  }
  if (lobbyModalClose && typeof CollabEngine !== 'undefined') {
    lobbyModalClose.addEventListener('click', () => CollabEngine.closeLobbyModal());
  }
  if (lobbyModal && typeof CollabEngine !== 'undefined') {
    lobbyModal.addEventListener('click', e => { if (e.target === lobbyModal) CollabEngine.closeLobbyModal(); });
  }
}

function closeDriveModal() {
  driveModal.classList.remove('active');
  document.body.style.overflow = '';
}

// ─── Card Events ──────────────────────────────────────────────────────────────
function bindCardEvents() {
  // Re-attach via delegation once per render
  collageGrid.removeEventListener('click', handleCardClick);
  collageGrid.addEventListener('click', handleCardClick);
}

function handleCardClick(e) {
  const deleteBtn   = e.target.closest('[data-action="delete"]');
  const downloadBtn = e.target.closest('[data-action="download"]');
  const card        = e.target.closest('.photo-card');
  if (!card) return;
  const id    = card.dataset.id;
  const index = photos.findIndex(p => p.id === id);
  if (index === -1) return;
  if (deleteBtn) { e.stopPropagation(); deletePhoto(index); return; }
  if (downloadBtn) { e.stopPropagation(); downloadPolaroidCard(index); return; }
  openLightbox(index);
}

// ─── Delete ───────────────────────────────────────────────────────────────────
function deletePhoto(index) {
  const card = collageGrid.querySelector(`[data-id="${photos[index].id}"]`);
  if (card) {
    card.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    card.style.transform  = 'scale(0.8)';
    card.style.opacity    = '0';
    const photoId = photos[index].id;
    setTimeout(async () => {
      if (typeof CollabEngine !== 'undefined' && CollabEngine.state.isCollaborative) {
        await CollabEngine.deletePhoto(photoId);
      } else {
        photos.splice(index, 1);
        if (idbDb) {
          try { await idbDelete(photoId); } catch (e) { /* ignore */ }
        }
        saveToStorage();
        renderUI();
      }
      showToast('Memory removed');
    }, 300);
  }
}

// ─── Lightbox ─────────────────────────────────────────────────────────────────
function openLightbox(index) {
  currentIndex = index;
  updateLightboxContent();
  lightbox.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeLightbox() {
  saveLightboxCaption();
  lightbox.classList.remove('active');
  document.body.style.overflow = '';
}

function navigateLightbox(dir) {
  saveLightboxCaption();
  currentIndex = (currentIndex + dir + photos.length) % photos.length;
  updateLightboxContent();
}

function updateLightboxContent() {
  const photo = photos[currentIndex];
  if (!photo) return;
  lightboxImg.src       = photo.dataUrl;
  lightboxImg.alt       = photo.caption || `Memory ${currentIndex + 1}`;
  lightboxCaption.value = photo.caption || '';
  lightboxDate.textContent = photo.addedAt ? `Added ${formatDate(photo.addedAt)}` : '';
  const polaroid = document.querySelector('.lightbox-polaroid');
  if (polaroid) {
    polaroid.style.animation = 'none';
    void polaroid.offsetHeight;
    polaroid.style.animation = '';
  }
}

function saveLightboxCaption() {
  if (!photos[currentIndex]) return;
  const newCaption = lightboxCaption.value.trim();
  if (photos[currentIndex].caption !== newCaption) {
    photos[currentIndex].caption = newCaption;

    if (photos[currentIndex].driveFileId && typeof DriveSync !== 'undefined' && DriveSync.isSignedIn) {
      DriveSync.updateDrivePhotoCaption(photos[currentIndex].driveFileId, newCaption);
    }

    if (typeof CollabEngine !== 'undefined' && CollabEngine.state.isCollaborative) {
      CollabEngine.updatePhotoCaption(photos[currentIndex].id, newCaption);
    } else {
      saveToStorage();
    }
    const card = collageGrid.querySelector(`[data-id="${photos[currentIndex].id}"]`);
    if (card) {
      // Sync persist caption bar
      const bar = card.querySelector('.photo-card-caption-bar');
      if (bar) {
        const captionEl = bar.querySelector('.card-caption');
        if (captionEl) captionEl.textContent = newCaption;
        bar.dataset.empty = newCaption ? 'false' : 'true';
        if (!newCaption) bar.dataset.empty = 'true';
        else delete bar.dataset.empty;
      }
      // Sync hover overlay caption
      const overlayCaption = card.querySelector('.overlay-caption');
      if (overlayCaption) overlayCaption.textContent = newCaption;
      // Sync polaroid label
      const labelEl = card.querySelector('.polaroid-label');
      if (labelEl) {
        labelEl.textContent = newCaption || `Memory #${currentIndex + 1}`;
        labelEl.classList.toggle('empty-caption', !newCaption);
      }
    }
  }
}

// ─── View All Captions Modal ──────────────────────────────────────────────────
function openCaptionsModal() {
  renderCaptionsList('');
  captionsSearchInput.value = '';
  captionsModal.classList.add('active');
  document.body.style.overflow = 'hidden';
  setTimeout(() => captionsSearchInput.focus(), 120);
}

function closeCaptionsModal() {
  captionsModal.classList.remove('active');
  document.body.style.overflow = '';
}

function renderCaptionsList(query) {
  const q = (query || '').toLowerCase();
  const filtered = photos
    .map((p, i) => ({ photo: p, origIndex: i }))
    .filter(({ photo }) => !q || (photo.caption || '').toLowerCase().includes(q));

  const withCaption = filtered.filter(x => x.photo.caption).length;
  captionsStats.textContent =
    `${withCaption} of ${photos.length} ${photos.length === 1 ? 'memory' : 'memories'} have captions`
    + (q ? ` · ${filtered.length} matching` : '');

  captionsList.innerHTML = '';
  if (!filtered.length) {
    captionsList.innerHTML = `<div class="captions-empty-msg">No captions match your search.<br>Click a photo to open it and add a caption.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach(({ photo, origIndex }) => {
    const row = document.createElement('div');
    row.className = 'caption-row';

    const thumb = document.createElement('img');
    thumb.className = 'caption-row-thumb';
    thumb.src = photo.dataUrl;
    thumb.alt = photo.caption || `Memory ${origIndex + 1}`;
    thumb.loading = 'lazy';

    const info = document.createElement('div');
    info.className = 'caption-row-info';

    const num = document.createElement('div');
    num.className = 'caption-row-num';
    num.textContent = `Memory ${origIndex + 1}` + (photo.addedAt ? ` · ${formatDate(photo.addedAt)}` : '');

    const text = document.createElement('div');
    text.className = 'caption-row-text' + (photo.caption ? '' : ' empty');
    text.textContent = photo.caption || 'No caption yet — click to add one';

    info.appendChild(num);
    info.appendChild(text);

    const openBtn = document.createElement('button');
    openBtn.className = 'caption-row-open';
    openBtn.title = 'Open in viewer';
    openBtn.textContent = '↗';

    row.appendChild(thumb);
    row.appendChild(info);
    row.appendChild(openBtn);

    const clickHandler = () => {
      closeCaptionsModal();
      openLightbox(origIndex);
    };
    row.addEventListener('click', clickHandler);
    openBtn.addEventListener('click', e => { e.stopPropagation(); clickHandler(); });

    frag.appendChild(row);
  });
  captionsList.appendChild(frag);
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function showToast(message, duration = 2800) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 350);
  }, duration);
}

// ─── Ambient particles ────────────────────────────────────────────────────────
function spawnAmbientParticles() {
  // Fewer particles on mobile for performance
  const isMobile = window.matchMedia('(max-width: 700px)').matches;
  const count = isMobile ? 8 : 18;

  const bg = document.getElementById('ambientBg');
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    const size    = Math.random() * 4 + 1;
    const x       = Math.random() * 100;
    const y       = Math.random() * 100;
    const dur     = Math.random() * 14 + 8;
    const del     = Math.random() * -14;
    const opacity = Math.random() * 0.3 + 0.05;
    dot.style.cssText = `
      position:absolute; width:${size}px; height:${size}px;
      left:${x}%; top:${y}%; border-radius:50%;
      background:hsl(${Math.random() > 0.5 ? 270 : 330},80%,75%);
      opacity:${opacity};
      animation:floatDot ${dur}s ${del}s ease-in-out infinite alternate;
      pointer-events:none;
    `;
    frag.appendChild(dot);
  }
  bg.appendChild(frag);

  if (!document.getElementById('ambientKF')) {
    const style = document.createElement('style');
    style.id = 'ambientKF';
    style.textContent = `
      @keyframes floatDot {
        from { transform: translate(0,0) scale(1); }
        to   { transform: translate(20px,-15px) scale(0.9); }
      }
    `;
    document.head.appendChild(style);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE DRIVE IMPORT
// ═══════════════════════════════════════════════════════════════════════════════

function initDriveUI() {
  const saved = localStorage.getItem(LS_API_KEY) || '';
  if (saved) {
    driveApiKeyInput.value = saved;
    updateApiKeyBadge(true);
  }

  // Initialize DriveSync if available
  if (typeof DriveSync !== 'undefined') {
    DriveSync.init();

    const btnDriveSignInText = document.getElementById('btnDriveSignInText');
    const btnDriveFolderFetch = document.getElementById('btnDriveFolderFetch');
    const driveSyncStatusMsg = document.getElementById('driveSyncStatusMsg');
    const btnDriveSignIn = document.getElementById('btnDriveSignIn');

    const updateDriveSyncUI = (status, detail) => {
      if (driveSyncStatusMsg) {
        driveSyncStatusMsg.textContent = `Status: ${detail || status}`;
      }
      if (DriveSync.isSignedIn) {
        if (btnDriveSignInText) btnDriveSignInText.textContent = '✓ Connected to Google Drive';
        if (btnDriveFolderFetch) btnDriveFolderFetch.style.display = 'inline-block';
      } else {
        if (btnDriveSignInText) btnDriveSignInText.textContent = 'Sign In with Google';
        if (btnDriveFolderFetch) btnDriveFolderFetch.style.display = 'none';
      }
    };

    DriveSync.onStatusChange(updateDriveSyncUI);
    updateDriveSyncUI(DriveSync.status);

    if (btnDriveSignIn) {
      btnDriveSignIn.addEventListener('click', () => {
        if (DriveSync.isSignedIn) {
          DriveSync.signOut();
          showToast('Disconnected from Google Drive');
        } else {
          DriveSync.signIn(async () => {
            showToast('☁️ Connected to Google Drive!');
            renderUI();
          });
        }
      });
    }

    if (btnDriveFolderFetch) {
      btnDriveFolderFetch.addEventListener('click', async () => {
        btnDriveFolderFetch.disabled = true;
        btnDriveFolderFetch.textContent = '⏳ Fetching...';
        try {
          const drivePhotos = await DriveSync.fetchFolderPhotos();
          if (drivePhotos && drivePhotos.length > 0) {
            let addedCount = 0;
            drivePhotos.forEach(dp => {
              if (!photos.some(p => p.id === dp.id || (p.driveFileId && p.driveFileId === dp.driveFileId))) {
                photos.push(dp);
                addedCount++;
              }
            });
            if (addedCount > 0) {
              saveToStorage();
              renderUI();
              showToast(`📁 ${addedCount} photo(s) imported from 'Mémoire Shared Photos' folder!`);
            } else {
              showToast('✦ All photos from your Drive folder are already in Mémoire');
            }
          } else {
            showToast('ℹ️ No photos found in your Google Drive folder yet');
          }
        } catch (err) {
          showToast(`❌ ${err.message}`);
        } finally {
          btnDriveFolderFetch.disabled = false;
          btnDriveFolderFetch.textContent = '📁 Import My Drive Folder';
        }
      });
    }
  }

  driveApiKeyToggle.addEventListener('click', () => {
    driveApiKeySection.classList.toggle('open');
  });

  driveApiKeySave.addEventListener('click', () => {
    const key = driveApiKeyInput.value.trim();
    if (!key) { showToast('⚠ Enter a valid API key first'); return; }
    localStorage.setItem(LS_API_KEY, key);
    updateApiKeyBadge(true);
    driveApiKeySection.classList.remove('open');
    showToast('🔑 API key saved!');
  });
  driveApiKeyInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') driveApiKeySave.click();
  });

  // Client ID UI event listeners
  const driveClientIdSection = document.getElementById('driveClientIdSection');
  const driveClientIdToggle = document.getElementById('driveClientIdToggle');
  const driveClientIdInput = document.getElementById('driveClientIdInput');
  const driveClientIdSave = document.getElementById('driveClientIdSave');

  if (driveClientIdInput && typeof DriveSync !== 'undefined') {
    const customId = localStorage.getItem('memoire_oauth_client_id') || '';
    if (customId) {
      driveClientIdInput.value = customId;
      updateClientIdBadge('custom');
    } else {
      driveClientIdInput.value = DriveSync.getClientId() || '';
      updateClientIdBadge('active');
    }
  }

  if (driveClientIdToggle) {
    driveClientIdToggle.addEventListener('click', () => {
      driveClientIdSection.classList.toggle('open');
    });
  }

  if (driveClientIdSave) {
    driveClientIdSave.addEventListener('click', () => {
      const id = driveClientIdInput.value.trim();
      if (!id) {
        DriveSync.setClientId('');
        showToast('⚙️ Reset to default Client ID');
        updateClientIdBadge('default');
      } else {
        DriveSync.setClientId(id);
        showToast('⚙️ OAuth Client ID saved!');
        updateClientIdBadge('custom');
      }
      if (driveClientIdSection) driveClientIdSection.classList.remove('open');
    });
  }

  let detectTimer;
  driveUrlInput.addEventListener('input', () => {
    clearTimeout(detectTimer);
    detectTimer = setTimeout(updateDetectBar, 350);
  });
}

function updateApiKeyBadge(isSet) {
  apiKeyBadge.textContent = isSet ? '✓ saved' : 'not set';
  apiKeyBadge.classList.toggle('set', isSet);
}

function updateClientIdBadge(mode) {
  const badge = document.getElementById('clientIdBadge');
  if (!badge) return;
  if (mode === 'custom') {
    badge.textContent = '✓ custom';
    badge.classList.add('set');
  } else {
    badge.textContent = 'active';
    badge.classList.remove('set');
  }
}

function updateDetectBar() {
  const lines = driveUrlInput.value.split('\n').map(l => l.trim()).filter(Boolean);
  driveDetectBar.innerHTML = '';
  const frag = document.createDocumentFragment();
  lines.forEach(line => {
    const type  = detectLinkType(line);
    const label = type === 'folder' ? '📁 Folder' : type === 'file' ? '🖼 File' : '❓ Unknown';
    const chip  = document.createElement('span');
    chip.className = `detect-chip ${type}`;
    chip.title = line;
    chip.textContent = `${label}: ${truncate(line, 32)}`;
    frag.appendChild(chip);
  });
  driveDetectBar.appendChild(frag);
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + '…' : str;
}

function detectLinkType(url) {
  if (!url) return 'unknown';
  if (/drive\.google\.com\/(drive\/(u\/\d+\/)?)?folders\//i.test(url)) return 'folder';
  if (/folderview/i.test(url) && /[?&]id=/i.test(url))                  return 'folder';
  if (/drive\.google\.com\/file\/d\//i.test(url))                        return 'file';
  if (/drive\.google\.com\/(open|uc)\?/i.test(url))                      return 'file';
  if (/lh3\.googleusercontent\.com/i.test(url))                          return 'file';
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url.trim()))                           return 'file';
  return 'unknown';
}

function extractDriveFolderId(url) {
  url = url.trim();
  let m = url.match(/\/folders\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/folderview/i.test(url)) {
    m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    if (m) return m[1];
  }
  return null;
}

function extractDriveFileId(url) {
  url = url.trim();
  let m = url.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(url)) return url;
  return null;
}

function driveImageUrls(fileId) {
  return [
    `https://lh3.googleusercontent.com/d/${fileId}`,
    `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
    `https://drive.google.com/uc?export=download&id=${fileId}`,
  ];
}

async function listFolderImages(folderId, apiKey) {
  const MIME_TYPES = [
    'image/jpeg','image/png','image/gif',
    'image/webp','image/heic','image/bmp','image/tiff',
  ];
  const mimeQ  = MIME_TYPES.map(m => `mimeType='${m}'`).join(' or ');
  const q      = encodeURIComponent(`'${folderId}' in parents and (${mimeQ}) and trashed=false`);
  const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType)');

  let allFiles  = [];
  let pageToken = '';

  do {
    const tokenParam = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '';
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=100&key=${apiKey}${tokenParam}`;
    const res  = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || `API error ${res.status}`);
    }
    const data = await res.json();
    allFiles   = allFiles.concat(data.files || []);
    pageToken  = data.nextPageToken || '';
  } while (pageToken);

  return allFiles;
}

function tryLoadImageUrls(urlList) {
  return new Promise((resolve, reject) => {
    let i = 0;
    function tryNext() {
      if (i >= urlList.length) { reject(new Error('All URLs failed')); return; }
      const url = urlList[i++];
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          // Compress Drive images the same way
          let { naturalWidth: w, naturalHeight: h } = img;
          if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
            if (w >= h) { h = Math.round(h * MAX_DIMENSION / w); w = MAX_DIMENSION; }
            else        { w = Math.round(w * MAX_DIMENSION / h); h = MAX_DIMENSION; }
          }
          const canvas  = document.createElement('canvas');
          canvas.width  = w;
          canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve({ dataUrl: canvas.toDataURL('image/jpeg', IMG_QUALITY), srcUrl: url });
        } catch(e) {
          resolve({ dataUrl: url, srcUrl: url });
        }
      };
      img.onerror = tryNext;
      img.src = url;
    }
    tryNext();
  });
}

function setDriveStatusItem(id, state, text) {
  let item = driveStatus.querySelector(`[data-sid="${id}"]`);
  if (!item) {
    item = document.createElement('div');
    item.className = 'drive-status-item';
    item.dataset.sid = id;
    item.innerHTML = `<span class="drive-status-icon"></span><span class="drive-status-text"></span>`;
    driveStatus.appendChild(item);
  }
  item.classList.remove('loading', 'success', 'error');
  item.classList.add(state);
  const icons = { loading: '<span class="spinner">⟳</span>', success: '✅', error: '❌' };
  item.querySelector('.drive-status-icon').innerHTML = icons[state] || '';
  item.querySelector('.drive-status-text').textContent = text;
}

async function importSingleFile(fileId, sid, fileName) {
  const label = fileName || fileId.slice(0, 16);
  setDriveStatusItem(sid, 'loading', `Loading "${label}"…`);
  const { dataUrl } = await tryLoadImageUrls(driveImageUrls(fileId));
  photos.push({
    id     : `drive_${fileId}_${Date.now()}`,
    dataUrl,
    caption: generateAutoCaption(fileName || '', Date.now()),
    addedAt: Date.now(),
    source : 'google_drive',
  });
  setDriveStatusItem(sid, 'success', `✓ "${label}" added`);
}

async function handleDriveImport() {
  const raw = driveUrlInput.value.trim();
  if (!raw) { showToast('⚠ Paste at least one Drive link first'); return; }

  const lines  = raw.split(/\n+/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return;

  const apiKey = (localStorage.getItem(LS_API_KEY) || '').trim();

  driveStatus.innerHTML      = '';
  driveImportBtn.disabled    = true;
  driveImportBtn.textContent = 'Importing…';

  let successCount = 0;

  const tasks = lines.map(async (line, idx) => {
    const sid  = `ln_${idx}`;
    const type = detectLinkType(line);

    if (type === 'unknown') {
      setDriveStatusItem(sid, 'error', `Not a recognised Drive link: ${truncate(line, 55)}`);
      return;
    }

    if (type === 'folder') {
      const folderId = extractDriveFolderId(line);
      if (!folderId) {
        setDriveStatusItem(sid, 'error', `Cannot extract folder ID from: ${truncate(line, 50)}`);
        return;
      }
      if (!apiKey) {
        setDriveStatusItem(sid, 'error', 'Folder detected — save your API key above first');
        driveApiKeySection.classList.add('open');
        return;
      }

      setDriveStatusItem(sid, 'loading', `Scanning folder "${folderId.slice(0, 14)}"…`);
      let files;
      try {
        files = await listFolderImages(folderId, apiKey);
      } catch(err) {
        setDriveStatusItem(sid, 'error', `Folder listing failed: ${err.message}`);
        return;
      }

      if (!files.length) {
        setDriveStatusItem(sid, 'error', `No images found in folder (${folderId.slice(0, 14)})`);
        return;
      }

      setDriveStatusItem(sid, 'loading', `Found ${files.length} image(s) — importing…`);

      let folderOk = 0;
      for (let fi = 0; fi < files.length; fi++) {
        const f    = files[fi];
        const fsid = `folder_${idx}_${fi}`;
        try {
          await importSingleFile(f.id, fsid, f.name);
          folderOk++;
          successCount++;
          setDriveStatusItem(sid, 'loading', `Folder: ${folderOk}/${files.length} imported…`);
        } catch(err) {
          setDriveStatusItem(fsid, 'error', `"${f.name}" failed — check sharing`);
        }
      }
      setDriveStatusItem(sid, 'success', `📁 Folder done: ${folderOk}/${files.length} images added`);
      return;
    }

    // FILE
    const fileId = extractDriveFileId(line);
    if (!fileId) {
      setDriveStatusItem(sid, 'error', `Cannot extract file ID from: ${truncate(line, 50)}`);
      return;
    }
    try {
      await importSingleFile(fileId, sid);
      successCount++;
    } catch(err) {
      setDriveStatusItem(sid, 'error', `"${fileId.slice(0, 14)}" failed — check sharing settings`);
    }
  });

  await Promise.allSettled(tasks);

  driveImportBtn.disabled    = false;
  driveImportBtn.textContent = 'Import Photos →';

  if (successCount > 0) {
    saveToStorage();
    renderUI();
    showToast(`📁 ${successCount} Drive ${successCount === 1 ? 'photo' : 'photos'} imported!`);
    if (successCount === lines.length || lines.length === 1) {
      setTimeout(() => closeDriveModal(), 1800);
    }
  } else {
    showToast('⚠ No photos imported — check sharing settings & API key');
  }
}
