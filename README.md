# X Follow Manager

X Follow Manager is a bulk follower management dashboard for X (Twitter). Sign in with your own X developer app (OAuth 2.0 PKCE), load a follows CSV in the browser, filter quiet accounts, and unfollow via the official X API.

The CSV never leaves the browser (`FileReader`). App keys and the user token stay in `window.localStorage`. Same-origin API routes forward requests to X; they do not store secrets on disk and do not use a server env token.

## Run locally

```bash
git clone https://github.com/wiiiimm/x-twitter-bulk-follower-management-dashboard.git
cd x-twitter-bulk-follower-management-dashboard
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

No `.env` token is required. `.gitignore` ignores `.env*`.

## Sign in (generate an OAuth 2.0 user token)

Unfollow needs a **user OAuth 2.0 access token**. Paste your app’s **Client ID** and **Client Secret** and this app generates one via Authorization Code with PKCE:

1. Create an app in the [X developer portal](https://developer.x.com/).
2. In **User authentication settings**, enable **OAuth 2.0** (Authorization Code with PKCE). App type: **Web App**.
3. Copy **Client ID** and **Client Secret** onto the login screen. These are not the OAuth 1.0a API Key / API Secret, and not an app-only bearer token.
4. Add the Website URL and Callback URL shown on the login screen (they match the origin you are using, including local `http://127.0.0.1:43147/oauth/callback`).
5. Click **Generate access token**. X asks you to authorise scopes `tweet.read`, `users.read`, `follows.write`, and `offline.access`. The app exchanges the code for a user access token (and refresh token) and stores them in local storage.

Logout clears the user session and keeps saved Client ID / Secret. **Clear saved Client ID and Secret** on the login screen removes those too.

If you already have a user OAuth 2.0 access token, expand **Already have a user OAuth 2.0 access token?** and paste it.

The dashboard then calls `GET https://api.x.com/2/users/me` to resolve the signed-in user. Unfollow uses:

`DELETE https://api.x.com/2/users/{source_user_id}/following/{target_user_id}`

where `source_user_id` is that authenticated user. Docs: [Unfollow user](https://docs.x.com/x-api/users/unfollow-user).

X may still return **403** on self-serve access even though the docs list the endpoint. The UI shows that error. It does not pretend the unfollow worked.

## Load a CSV

1. After sign-in, click **Choose CSV** and pick the scan file. Parsing uses `FileReader`. The file is not uploaded.
2. Or click **Load sample** to use `public/sample-follows.csv`.

Expected header:

```
accountId,handle,name,lastPostAt,status,url
```

`lastPostAt` is ISO UTC or empty. `status` is informational (`active` / `quiet` / `error`). `url` is `https://x.com/{handle}`.

## Use

1. Set a cutoff datetime (local), or use the 30 days / 90 days / 1 year / Now shortcuts. The table shows accounts whose last post is **before** that cutoff, plus anyone with no `lastPostAt`.
2. Changing the cutoff unchecks everyone, then shows the new filtered set.
3. **Check all** / **Uncheck all** apply only to the current filtered rows that are not whitelisted.
4. Click the profile URL in a row to open that X profile in a new tab. Rows, handles, and other cells do not open profiles.
5. **Whitelist** (or **Whitelist all (selected)**) stores account IDs in `localStorage`. Whitelisted rows stay visible, cannot be checked, are skipped by Check all, and have Unfollow disabled. **Remove from whitelist** turns that back on.
6. **Unfollow** or **Unfollow all (selected)** adds accounts to a client-side queue (after confirm). X’s documented limit for `DELETE /2/users/:source_user_id/following/:target_user_id` is **50 requests per 15 minutes per user**. The queue waits a **random 45–110 seconds** between calls (about 8–20 per 15 minutes), including before the first call, and if X returns **429** it waits for `retry-after` / `x-rate-limit-reset` plus extra jitter. Pause and Stop control the queue. A successful row is removed. Other API errors stay on screen and the queue continues.

GET `/2/users/me` is 75/15 min per user and is only used at login, not on every unfollow.

## Scripts

```bash
npm run dev      # http://127.0.0.1:43147
npm run build
npm run start -- --port 43147
npm run lint
```

## Licence

MIT. See `LICENSE`.
