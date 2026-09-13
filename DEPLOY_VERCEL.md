# Deploy Memoire to Vercel

## Frontend

1. Push this repository to GitHub, GitLab, or Bitbucket.
2. In Vercel, select **Add New Project** and import the repository.
3. Use **Other** as the framework preset, leave the build and install commands empty, and use the repository root as the output directory.
4. Deploy. The static app will be available at a Vercel URL such as `https://memoire-your-name.vercel.app`.

## Collaboration backend

The current backend uses a long-running Express and Socket.IO process plus SQLite. Deploy `backend/` separately to Cloud Run, Railway, Render, or Fly.io. It should not be deployed as a Vercel static site or serverless function.

Set these backend variables:

```text
PORT=8080
FRONTEND_ORIGIN=https://memoire-your-name.vercel.app
GOOGLE_CLIENT_ID=your-production-client-id
GOOGLE_CLIENT_SECRET=your-rotated-secret
```

Use durable storage for SQLite before relying on shared photos. Cloud Run's local filesystem is ephemeral.

## Connect the frontend

The frontend is static, so Vercel variables are not automatically injected into browser JavaScript. In `index.html`, add this immediately before the `collaborative.js` script and replace the URL with your deployed backend:

```html
<script>
  window.MEMOIRE_API_BASE = 'https://your-api-host.example.com';
</script>
<script src="collaborative.js"></script>
```

Commit and redeploy after changing the URL.

## Google Cloud

Add the exact Vercel URL under **Authorized JavaScript origins** in Google Cloud Console. If you use a custom domain, add that HTTPS origin too. Publish the policy pages at `/privacy.html` and `/terms.html`.

## Test

1. Open the Vercel URL over HTTPS.
2. Test Drive sign-in.
3. Open **Lobbies**, create a space, and copy the invite link.
4. Open the invite link in a private window and join with another name.
5. Upload a photo and confirm it appears in both windows.
6. Check `https://your-api-host.example.com/health`.

Never commit `.env`, `backend/.env`, OAuth client secrets, or Drive API secrets.
