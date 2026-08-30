# X/Twitter Bulk Follower Management Dashboard

This is a bulk follower management dashboard for X (Twitter). Paste a user OAuth 2.0 token, load a follows CSV in the browser, filter quiet accounts, and unfollow via the official X API.

The CSV never leaves the browser (`FileReader`). The token is stored in `window.localStorage` only. Same-origin API routes forward `Authorization` to X; they do not read a server env token and do not persist the token.

## Run locally

```bash
git clone https://github.com/wiiiimm/x-twitter-bulk-follower-management-dashboard.git
cd x-twitter-bulk-follower-management-dashboard
npm install
npm run dev
```

Open [http://127.0.0.1:43147](http://127.0.0.1:43147).

No `.env` token is required. `.gitignore` ignores `.env*`.

## Sign in (user OAuth token)

The login screen asks for an **X API user OAuth 2.0 access token** (not an app-only bearer token), with scopes:

- `follows.write`
- `tweet.read`
- `users.read`

How to get one:

1. Create an app in the [X developer portal](https://developer.x.com/).
2. Enable user authentication (OAuth 2.0 Authorization Code with PKCE).
3. Request a user access token with the scopes above (for example with `twurl` or a small local PKCE flow).
4. Paste the token on the login screen. Logout clears it from local storage.

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
3. **Check all** / **Uncheck all** apply only to the current filtered rows.
4. Click a row, handle, or profile URL to open it. The app tries an iframe first. x.com sends `X-Frame-Options: SAMEORIGIN`, so the iframe is refused and the profile opens in a new tab.
5. **Unfollow** on a row, or **Unfollow all (selected)**. The bulk action asks you to confirm and includes the selected count before it calls the backend.
6. Each unfollow is `DELETE` for that `accountId`. A successful row is removed and unchecked. API errors stay on screen.

## Scripts

```bash
npm run dev      # http://127.0.0.1:43147
npm run build
npm run start -- --port 43147
npm run lint
```

## Licence

MIT. See `LICENSE`.
