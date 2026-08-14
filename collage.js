/**
 * collage.js — Layout Engine for Memory Book (Optimised v2)
 * Handles masonry, grid, and scattered layouts.
 * Uses IntersectionObserver for lazy image loading.
 * Uses DocumentFragment for batch DOM insertion.
 */

const STICKERS = ['🌸', '💫', '🌟', '❤️', '🎉', '🌈', '✨', '🦋', '🌙', '🎈', '🍀', '🌺'];
const TILTS    = [-3, -2, -1.5, -1, 0, 1, 1.5, 2, 3]; // degrees for scattered mode

// ─── Lazy Load Observer ───────────────────────────────────────────────────────
let lazyObserver = null;

function getLazyObserver() {
  if (!lazyObserver) {
    lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.src) {
            img.src = img.dataset.src;
            delete img.dataset.src;
          }
          lazyObserver.unobserve(img);
        }
      });
    }, { rootMargin: '200px 0px' }); // start loading 200px before visible
  }
  return lazyObserver;
}

/**
 * Lightweight deterministic hash from a string (photo.id).
 * Returns a float in [0, 1) that is stable for the same id.
 */
function seededRandom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  return (h >>> 0) / 4294967296;
}

/**
 * Determine card style variant based on index + photo id.
 * Polaroid: ~15% of cards (reduced by >80% to serve as rare, special visual accents).
 * Sticker: every 5th card.
 */
function getCardVariant(index, photoId) {
  const rng = seededRandom(photoId || String(index));
  const isPolaroid = rng < 0.15;
  return {
    isPolaroid : isPolaroid,
    hasSticker : (index % 5 === 3),
    hasTape    : isPolaroid && (rng > 0.08),
    sticker    : STICKERS[index % STICKERS.length],
    tilt       : TILTS[index % TILTS.length],
    animDelay  : `${Math.min(index * 0.04, 0.8)}s`,
  };
}

/**
 * Build a single photo card DOM element.
 */
function buildPhotoCard(photo, index, layout = 'masonry') {
  const variant = getCardVariant(index, photo.id, layout);
  const card = document.createElement('div');
  card.className = 'photo-card';
  card.dataset.id = photo.id;
  card.style.animationDelay = variant.animDelay;
  card.style.setProperty('--tilt', `${variant.tilt}deg`);

  if (variant.isPolaroid) card.classList.add('polaroid-style');
  if (variant.hasTape) {
    const tape = document.createElement('div');
    tape.className = 'polaroid-tape';
    card.appendChild(tape);
  }
  if (variant.hasSticker) {
    card.classList.add('has-sticker');
    card.dataset.sticker = variant.sticker;
  }

  const img = document.createElement('img');
  img.alt = photo.caption || `Memory ${index + 1}`;
  img.style.maxHeight = getMaxHeight(index, variant.isPolaroid);
  // Use IntersectionObserver lazy loading: first few cards load eagerly
  if (index < 6) {
    img.src = photo.dataUrl;
  } else {
    img.dataset.src = photo.dataUrl;
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; // 1px placeholder
    getLazyObserver().observe(img);
  }

  // ── Always-visible caption strip (standard cards) ──────────────────
  const captionBar = document.createElement('div');
  captionBar.className = 'photo-card-caption-bar';
  if (!photo.caption) captionBar.dataset.empty = 'true';

  const captionEl = document.createElement('div');
  captionEl.className = 'card-caption';
  captionEl.textContent = photo.caption || '';
  captionBar.appendChild(captionEl);

  // ── Hover overlay with duplicated caption + actions ────────────────
  const overlay = document.createElement('div');
  overlay.className = 'photo-card-overlay';

  const overlayCaption = document.createElement('div');
  overlayCaption.className = 'overlay-caption';
  overlayCaption.textContent = photo.caption || '';

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const editBtn = document.createElement('button');
  editBtn.className = 'card-btn';
  editBtn.textContent = '✏ Caption';
  editBtn.dataset.action = 'open';

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'card-btn download';
  downloadBtn.textContent = '📥';
  downloadBtn.title = 'Download Polaroid';
  downloadBtn.dataset.action = 'download';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'card-btn delete';
  deleteBtn.textContent = '🗑';
  deleteBtn.dataset.action = 'delete';

  actions.appendChild(editBtn);
  actions.appendChild(downloadBtn);
  actions.appendChild(deleteBtn);
  overlay.appendChild(overlayCaption);
  overlay.appendChild(actions);

  card.appendChild(img);
  card.appendChild(captionBar);
  card.appendChild(overlay);

  // ── Polaroid Chin Footer with Full Data ─────────────────────────────
  if (variant.isPolaroid) {
    const polaroidFooter = document.createElement('div');
    polaroidFooter.className = 'polaroid-footer';

    const label = document.createElement('div');
    label.className = 'polaroid-label' + (photo.caption ? '' : ' empty-caption');
    label.textContent = photo.caption || `Memory #${index + 1}`;

    const meta = document.createElement('div');
    meta.className = 'polaroid-meta';

    const dateSpan = document.createElement('span');
    dateSpan.className = 'polaroid-date';
    dateSpan.textContent = formatDate(photo.addedAt || Date.now());

    const badgeSpan = document.createElement('span');
    badgeSpan.className = 'polaroid-badge';
    badgeSpan.textContent = `#${String(index + 1).padStart(2, '0')}`;

    meta.appendChild(dateSpan);
    meta.appendChild(badgeSpan);

    polaroidFooter.appendChild(label);
    polaroidFooter.appendChild(meta);
    card.appendChild(polaroidFooter);
  }

  return card;
}

/**
 * Compact image heights for natural masonry feel without oversized polaroids.
 */
function getMaxHeight(index, isPolaroid = false) {
  if (isPolaroid) {
    const polaroidHeights = ['210px', '170px', '200px', '240px', '160px', '210px', '180px'];
    return polaroidHeights[index % polaroidHeights.length];
  }
  const heights = ['240px', '190px', '220px', '270px', '175px', '230px', '205px'];
  return heights[index % heights.length];
}

/**
 * Render the entire collage grid.
 * Uses DocumentFragment for a single DOM write.
 */
function renderCollage(photos, container, layout = 'masonry') {
  // Disconnect previous observers before clearing
  if (lazyObserver) {
    lazyObserver.disconnect();
    lazyObserver = null;
  }

  container.innerHTML = '';
  container.className = 'collage-grid masonry';

  const frag = document.createDocumentFragment();
  photos.forEach((photo, index) => {
    frag.appendChild(buildPhotoCard(photo, index));
  });
  container.appendChild(frag); // single reflow
}

/**
 * Format a date timestamp to a readable string.
 */
function formatDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day  : 'numeric',
    year : 'numeric',
  });
}

/**
 * Shuffle array in-place (Fisher-Yates).
 */
function shuffleArray(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}
