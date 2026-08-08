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
 * Polaroid: random ~20% of cards (stable per photo id).
 * Sticker: every 5th card.
 */
function getCardVariant(index, photoId) {
  const rng = seededRandom(photoId || String(index));
  return {
    isPolaroid : rng < 0.20,           // ~1 in 5
    hasSticker : (index % 5 === 3),
    sticker    : STICKERS[index % STICKERS.length],
    tilt       : TILTS[index % TILTS.length],
    animDelay  : `${Math.min(index * 0.04, 0.8)}s`,
  };
}

/**
 * Build a single photo card DOM element.
 */
function buildPhotoCard(photo, index) {
  const variant = getCardVariant(index, photo.id);
  const card = document.createElement('div');
  card.className = 'photo-card';
  card.dataset.id = photo.id;
  card.style.animationDelay = variant.animDelay;
  card.style.setProperty('--tilt', `${variant.tilt}deg`);

  if (variant.isPolaroid) card.classList.add('polaroid-style');
  if (variant.hasSticker) {
    card.classList.add('has-sticker');
    card.dataset.sticker = variant.sticker;
  }

  const img = document.createElement('img');
  img.alt = photo.caption || `Memory ${index + 1}`;
  img.style.maxHeight = getMaxHeight(index);
  // Use IntersectionObserver lazy loading: first few cards load eagerly
  if (index < 6) {
    img.src = photo.dataUrl;
  } else {
    img.dataset.src = photo.dataUrl;
    img.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='; // 1px placeholder
    getLazyObserver().observe(img);
  }

  // ── Always-visible caption strip ──────────────────────────────────
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

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'card-btn delete';
  deleteBtn.textContent = '🗑';
  deleteBtn.dataset.action = 'delete';

  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);
  overlay.appendChild(overlayCaption);
  overlay.appendChild(actions);

  card.appendChild(img);
  card.appendChild(captionBar);
  card.appendChild(overlay);

  if (variant.isPolaroid) {
    const label = document.createElement('div');
    label.className = 'polaroid-label';
    label.textContent = photo.caption || formatDate(photo.addedAt);
    card.appendChild(label);
  }

  return card;
}

/**
 * Vary image heights for natural masonry feel.
 */
function getMaxHeight(index) {
  const heights = ['380px', '260px', '320px', '480px', '200px', '340px', '290px'];
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
  container.className = `collage-grid ${layout}`;

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
