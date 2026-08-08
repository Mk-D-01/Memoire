# 📸 Mémoire — Your Personal Memory Book

<div align="center">

  <p align="center">
    <strong>A Pinterest-inspired, aesthetic memory board & photo collage studio that runs 100% client-side.</strong>
  </p>

  <p align="center">
    <img src="https://img.shields.io/badge/JavaScript-Vanilla_ES6+-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black" alt="Vanilla JS" />
    <img src="https://img.shields.io/badge/CSS3-Modern_Tokens_%26_Animations-1572B6?style=for-the-badge&logo=css3&logoColor=white" alt="CSS3" />
    <img src="https://img.shields.io/badge/Storage-IndexedDB_%2B_Local-4E86E4?style=for-the-badge&logo=databricks&logoColor=white" alt="IndexedDB" />
    <img src="https://img.shields.io/badge/Cloud-Google_Drive_Sync-4285F4?style=for-the-badge&logo=googledrive&logoColor=white" alt="Google Drive" />
    <img src="https://img.shields.io/badge/PWA-Ready-5A0FC8?style=for-the-badge&logo=pwa&logoColor=white" alt="PWA Ready" />
    <img src="https://img.shields.io/badge/Dependencies-Zero-success?style=for-the-badge" alt="Zero Dependencies" />
  </p>

</div>

---

## 🌟 Overview

**Mémoire** is a lightweight, privacy-focused web application designed to turn your scattered photos into an artful, interactive memory journal. With fluid masonry layouts, polaroid styling, instant search, cloud backup, and responsive touch gestures, Mémoire delivers an elegant scrapbook experience right inside the browser.

Built with **zero external runtime dependencies**, it requires no Node.js build step or backend servers—making it lightning-fast, easy to deploy, and completely local-first.

---

## ✨ Features at a Glance

### 🎨 Dynamic Layout Modes
- **Masonry View**: Multi-column Pinterest-style waterfall that organically arranges portrait and landscape photos.
- **Grid View**: Clean, balanced modern grid for uniform viewing.
- **Scattered Scrapbook View**: Playful rotations, organic micro-tilts, polaroid borders, and decorative stickers (`🌸`, `✨`, `💫`, `🎉`).
- **One-Click Shuffle**: Instantly randomize and restyle photo arrangements for a fresh perspective.

### 🖼️ Interactive Lightbox & Captions Studio
- **Polaroid-Inspired Viewer**: Immersive full-screen lightbox with date metadata and inline caption editing.
- **Touch & Gesture Navigation**: Full swipe gestures on mobile (`TouchEvents`) and keyboard navigation (`←` / `→` / `Esc`).
- **All Captions Search Modal**: Filter and search through all your photo captions with real-time text matching and direct jump-to-photo links.

### ⚡ Client-Side Performance & Optimization
- **Smart Image Compression**: HTML5 Canvas auto-downscales large images (up to 1600px max dimension with 88% JPEG quality) to conserve memory and maintain fast rendering.
- **Lazy Loading with `IntersectionObserver`**: High-res images load just-in-time as they scroll into view.
- **Batch DOM Injection**: Utilizes `DocumentFragment` to prevent layout thrashing and render large collections smoothly.
- **Ambient Particle Engine**: Lightweight floating particle background scheduled via `requestIdleCallback` for smooth 60fps performance.

### ☁️ Cloud & Local Storage Architecture
- **Dual-Tier Offline Persistence**:
  - `IndexedDB` (`memoireDB`): High-capacity local storage for high-resolution photo data.
  - `localStorage` & `sessionStorage`: Instant layout state and scroll position restoration across tab reloads.
- **Google Drive Integration**:
  - **Batch Import**: Import multiple public Google Drive files or entire folders via Google Drive REST API v3.
  - **Private AppData Sync**: Optional session backup and restore directly to the user's hidden Google Drive `appDataFolder` using Google Identity Services (GIS).

### 📱 Progressive Web App (PWA)
- Fully installable with `manifest.json`.
- Supports standalone mobile display, notched device safe-area insets, and smooth drag-and-drop overlays.

---

## 🛠️ Tech Stack

| Domain | Technology / API | Purpose |
|---|---|---|
| **Core Logic** | Vanilla JavaScript (ES6+) | Application state, drag-and-drop, event delegation, and layout logic |
| **Markup** | Semantic HTML5 | Accessible modals (`role="dialog"`), accessible forms, and clean markup |
| **Styling** | Vanilla CSS3 | Custom CSS variables / design tokens, glassmorphism, flexbox, CSS columns & keyframe animations |
| **Typography** | Google Fonts | *Playfair Display* (editorial serif), *Dancing Script* (scrapbook cursive), *Inter* (clean UI) |
| **Local Database** | IndexedDB API | High-volume client-side storage for image blobs and data URLs |
| **Caching** | Web Storage API | `localStorage` (API keys & metadata) and `sessionStorage` (tab restore) |
| **Media Processing** | Canvas 2D API & FileReader | Client-side compression and aspect-ratio preservation |
| **Cloud Services** | Google Drive REST API v3 & GIS | Folder scanning, file retrieval, and private AppData folder sync |
| **Installation** | Web App Manifest | Standalone PWA installation support |

---

## 📂 Project Structure

```text
Memoire/
├── index.html        # Main HTML entry point, semantic DOM structure & modals
├── style.css         # Design tokens, themes, layout modes, animations & media queries
├── app.js            # Core controller: storage, image compression, events, Drive import
├── collage.js        # Layout engine: masonry/grid/scattered builder & lazy-load observer
├── drive-sync.js     # Google Identity Services (GIS) & appDataFolder cloud backup module
├── manifest.json     # PWA configuration, theme colors, icons & standalone settings
└── README.md         # Documentation & repository showcase
```

---

## 🚀 Getting Started

Because **Mémoire** is built with pure vanilla web technologies, you do not need to install `npm` packages or configure bundlers.

### Option 1: Live Server / Local Web Server
Clone the repository and serve it using any static HTTP server:

```bash
# Clone the repository
git clone https://github.com/<your-username>/Memoire.git
cd Memoire

# Using Python 3
python -m http.server 3000

# OR using Node.js npx serve
npx serve .
```

Open `http://localhost:3000` in your browser.

### Option 2: Direct Browser Launch
You can also open `index.html` directly in modern browsers (Chrome, Edge, Firefox, Safari).

---

## 🔑 Google Drive Integration Setup (Optional)

Mémoire works 100% offline out-of-the-box. To enable Google Drive folder imports:

1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a project and enable the **Google Drive API**.
3. Generate an **API Key** under *APIs & Services → Credentials*.
4. Open Mémoire, click **Drive** in the top bar, expand **Google Drive API Key**, paste your key, and click **Save**.
5. Paste any publicly shared Google Drive folder or file link (`Anyone with the link can view`) to import all memories instantly.

---

## ⌨️ Keyboard & Gesture Shortcuts

| Shortcut / Gesture | Action |
|---|---|
| `Drag & Drop` (Anywhere) | Drop image files to instantly import into the memory book |
| `←` / `→` Arrow Keys | Navigate to previous / next photo in Lightbox |
| `Swipe Left` / `Swipe Right` | Previous / next photo on touchscreens and mobile |
| `Enter` (in Lightbox Caption) | Save caption and finish editing |
| `Escape` | Close active Lightbox or Modals |

---

## 🔒 Privacy & Data Ownership

- **100% Local-First**: All uploaded photos and captions are stored in your browser's local `IndexedDB`.
- **No Third-Party Tracking**: No analytics scripts, no third-party cookies, and no tracking pixels.
- **User-Controlled Cloud Sync**: Drive syncing connects directly from your browser to your own Google account.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

---

<div align="center">
  <sub>Crafted with passion for preserving memories. If you like this project, feel free to ⭐ star the repository!</sub>
</div>
