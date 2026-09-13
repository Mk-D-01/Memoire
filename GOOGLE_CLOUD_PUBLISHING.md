# Google Cloud Publishing Inputs

This checklist is for publishing the current Mémoire app. Replace every `REPLACE_WITH_...` value before submitting OAuth verification or sharing the app publicly.

## Required values to decide

| Input | Example | Where it is used |
|---|---|---|
| Production web origin | `https://memories.example.com` | OAuth authorized JavaScript origin and public app URL |
| Privacy policy URL | `https://memories.example.com/privacy.html` | OAuth consent screen and public app footer |
| Terms URL | `https://memories.example.com/terms.html` | Public app footer and app documentation |
| Support email | `support@example.com` | OAuth consent screen and policy pages |
| Developer contact email | `owner@example.com` | Google OAuth verification contact |
| App name | `Mémoire` | OAuth consent screen and browser title |
| Cloud project ID | `memoire-production` | Google Cloud resources and billing |
| Backend API origin, if used | `https://api.example.com` | `MEMOIRE_API_BASE` and CORS |

A domain cannot be created from inside this repository. Buy or assign one, point its DNS record to the chosen Google hosting service, and then replace the example values above with the real URLs.

## Google Cloud Console inputs

1. Create or select a Google Cloud project.
2. Enable **Google Drive API**. The current app also loads Google Identity Services in the browser.
   - Shared spaces require the sensitive OAuth scope `https://www.googleapis.com/auth/drive`.
   - Each collaborator must authorize Drive access before viewing or uploading to a private shared folder.
3. Configure **OAuth consent screen**:
   - App name: `Mémoire`
   - User support email: your support email
   - App logo: optional, use a real hosted PNG if supplied
   - Application home page: production web origin
   - Privacy policy link: production web origin + `/privacy.html`
   - Terms of service link: production web origin + `/terms.html`
   - Developer contact information: developer contact email
   - Authorized domain: the registrable domain only, such as `example.com`
4. Create a **Web application** OAuth client:
   - Authorized JavaScript origins: production web origin, plus local origins used for development
   - Do not add a path, slash, or API origin to the JavaScript origin
5. Restrict the Google Drive API key, if public-link imports are used:
   - Application restriction: HTTP referrers
   - Allowed referrer: `https://your-real-domain.example/*`
   - API restriction: Google Drive API only
6. Configure billing if the selected Google Cloud product requires it.

## Hosting choice

### Static PWA only

The core photo journal and backend-free Drive Spaces can be hosted as static files on Vercel, Firebase Hosting, or Cloud Storage website hosting. They do not need the Node backend. Shared Drive links use the format `https://your-domain.example/?driveFolder=FOLDER_ID`.

### Collaboration enabled

The `backend/` service is a separate Node.js service using Socket.IO and SQLite. For production, deploy it as a long-running service such as Cloud Run and set:

```text
PORT=8080
GOOGLE_CLIENT_ID=your-production-client-id
GOOGLE_CLIENT_SECRET=your-rotated-secret
```

Then set the frontend API base before loading `collaborative.js`:

```html
<script>window.MEMOIRE_API_BASE = 'https://api.example.com';</script>
```

The backend must restrict CORS to the production web origin. Do not use `origin: '*'` in production. SQLite on ephemeral Cloud Run storage is not durable; use a managed database or persistent storage before relying on collaboration for important data.

## Before publishing

- [ ] Replace `REPLACE_WITH_SUPPORT_EMAIL` in `privacy.html` and `terms.html`.
- [ ] Publish both pages and verify they are reachable without signing in.
- [ ] Replace placeholder domain values in this document and Google Cloud Console.
- [ ] Rotate the Google OAuth client secret currently present in local environment files.
- [ ] Confirm `.env` and `backend/.env` are not committed or uploaded.
- [ ] Add the production origin to OAuth and CORS configuration.
- [ ] Test Google sign-in and Drive access on the production HTTPS origin.
- [ ] Complete Google's OAuth verification if the app is public and requests the full Drive scope.
- [ ] Test the privacy policy and terms links on desktop and mobile.
