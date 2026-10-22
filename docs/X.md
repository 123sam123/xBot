# Posting to X

xBot posts with the **official X API** and **your own X developer app**. No
password, no session cookie, no hosted relay, and no secret inside the
binary: you create the app, paste its Client ID into xBot, and sign in once in
your browser. T9 (XBOT-OE2XV9) built this; the code lives in
`src/main/services/x/`.

Everything below was checked against docs.x.com on **2026-10-22**. X changes
its API and its prices; when something here disagrees with docs.x.com or the
Developer Console, they win.

## Setup (once)

1. Open the [X Developer Console](https://console.x.com) and create a Project
   and an App in it.
2. Open the app's **User authentication settings** and turn on **OAuth 2.0**.
   - **Type of App:** **Native App**. That makes it a *public client*: it uses
     PKCE only and has no Client Secret, so there is nothing secret to embed.
   - **App permissions:** **Read and write**. With "Read" alone X never grants
     `tweet.write` and xBot stops with "Set your X app's permissions to Read
     and write".
   - **Callback URI / Redirect URL:** `http://127.0.0.1:47813/callback`,
     exactly (X compares it character for character). If you change the port
     in xBot → Settings → X, register the URL xBot shows there instead.
   - **Website URL:** any page of yours; X requires the field.
3. On the app's **Keys and tokens** page, copy the **OAuth 2.0 Client ID**
   (not the API Key) into xBot → Settings → X → Client ID. Native Apps get no
   Client Secret, and xBot never asks for one.
4. Click **Connect X account**. Your browser opens X's consent page; approve
   it and come back to xBot. The header shows your real handle.

X's consent page signs in whichever account the browser is using. To connect
a second account, switch accounts on x.com first, then choose **Add another
account…** in xBot's account menu.

## Cost

X API access is **pay-per-use**: you buy credits in the Developer Console and
each request is deducted from them. There is no subscription and no free
allowance listed. On 2026-10-22 the console listed, per request:

| Operation | Price |
|---|---|
| Post: Create | $0.015 |
| Post: Create (with URL) | $0.200 |
| Owned reads (your own timeline, used by "Check X") | $0.001 per post returned |

X says "prices are subject to change", only successful requests are billed,
and requests fail once credits run out. xBot therefore says only that X API
usage **may be billed to your own X developer account**. It is separate from
the local AI, which is free and never leaves your Mac. Set a spending limit and
balance alerts in the console if you want a ceiling.

## How connecting works

OAuth 2.0 Authorization Code with PKCE, as X documents for public clients:

| Step | Detail |
|---|---|
| Authorize | `https://x.com/i/oauth2/authorize` with `response_type=code`, `client_id`, `redirect_uri`, `scope`, `state` (32 random bytes), `code_challenge` (SHA-256 of a 32-byte verifier), `code_challenge_method=S256` |
| Scopes | `tweet.read tweet.write users.read offline.access media.write` (`offline.access` gives a refresh token; `media.write` allows uploads) |
| Callback | A listener on `127.0.0.1:<port>` only (X: use `127.0.0.1`, not `localhost`). It answers only `GET /callback` with the right `Host`, ignores a wrong `state` (400) and keeps waiting, and closes after the callback, on Cancel, or after 5 minutes |
| Token | `POST https://api.x.com/2/oauth2/token`, form body `grant_type=authorization_code`, `code`, `redirect_uri`, `code_verifier`, `client_id` (public clients send `client_id` in the body and no Basic auth). X's code is valid for **30 s**, so the exchange runs at once |
| Who am I | `GET https://api.x.com/2/users/me` gives the id and the real handle |
| Refresh | Access tokens last **2 hours**. xBot refreshes on use, within 60 s of expiry, with `grant_type=refresh_token`, `refresh_token`, `client_id`. Refresh tokens are treated as single-use: each refresh stores the new pair, and concurrent callers share one refresh |
| Revoke | `POST https://api.x.com/2/oauth2/revoke` with `token`, `client_id`, on Disconnect (best effort; you can also remove the app under X → Settings → Connected apps) |

Tokens are encrypted with Electron `safeStorage` (the macOS Keychain) before
they touch the database. If encryption is unavailable, or on Linux the
backend is the plain-text fallback `basic_text`, xBot refuses to connect and
stores nothing. Tokens are bound to this Mac: a restored backup or a denied
Keychain prompt shows **Reconnect** instead.

## How posting works

Post ↑ creates one **publish job** that freezes the account, the exact text
and the media. Every state change is written to SQLite before the next
request goes out:

```
queued → uploading → processing → publishing → published
                                 ↘ failed / canceled / needs_reconciliation
```

- **Media upload (v2):** `POST /2/media/upload/initialize` (JSON
  `media_type`, `total_bytes`, `media_category`), then
  `POST /2/media/upload/{id}/append` (multipart `media` + `segment_index`,
  4 MB chunks; X allows up to 5 MB), then `POST /2/media/upload/{id}/finalize`.
  If finalize returns `processing_info`, xBot polls
  `GET /2/media/upload?command=STATUS&media_id=` after `check_after_secs` and
  shows `progress_percent` (video processing).
- **Create:** `POST https://api.x.com/2/tweets` with `{ text, media: { media_ids } }`
  → `201 { data: { id } }`. xBot stores that id and shows
  `https://x.com/i/web/status/<id>`.
- **Never twice.** Repeated clicks return the same job. If the create request
  times out, the network drops, X answers 5xx, or xBot quits while it is in
  flight, the job goes to **needs reconciliation** and is never retried on its
  own. "Check X" reads your recent posts
  (`GET /2/users/:id/tweets`, `expansions=attachments.media_keys`) and marks
  the job posted if it finds it: by media id for a post with media, by text
  (with links replaced, since X rewrites them to t.co) otherwise. If it is not
  there, you choose **Retry post** or **Mark as not posted**.

### Limits xBot checks before uploading

| Rule | Source |
|---|---|
| 280 weighted characters (URLs count 23, emoji and CJK 2), via `twitter-text` | X counting rules |
| Up to 4 images, **or** 1 GIF, **or** 1 video, never mixed | `POST /2/tweets`: "up to 4 photos, 1 animated GIF, or 1 video" |
| Images (`tweet_image`) ≤ 5 MB | media upload docs |
| GIFs (`tweet_gif`) ≤ 15 MB | media upload docs |
| Video (`tweet_video`) ≤ 1 GB (xBot's import cap; X allows 8 GB) | media upload docs |

Video length is left to X because it depends on the account: 20 minutes
by default, 125 minutes with Premium. X's refusal is shown as "media
rejected" with its own words.

### Rate limits

Per user: 100 posts per 15 minutes (10 000 per day per app), 1 875 upload
calls and 1 000 status checks per 15 minutes, 75 `/users/me` and 900
timeline reads per 15 minutes. A `429` carries `x-rate-limit-reset` (epoch
seconds; `x-user-limit-24hour-reset` for the daily cap), shown as "Rate
limited until HH:MM". xBot does not retry a create on its own.

## Troubleshooting

| xBot says | Do this |
|---|---|
| Add your X app's Client ID first (`x_client_id_missing`) | Paste the OAuth 2.0 Client ID into Settings → X. |
| macOS Keychain encryption isn't available (`x_secure_storage_unavailable`) | xBot will not store tokens unencrypted. On macOS, unlock the login keychain; on Linux, run a Secret Service (GNOME Keyring or KWallet). |
| Port 47813 is in use (`x_callback_port_busy`) | Quit the app using it, or pick another port in Settings → X **and** register the new callback URL in your X app. |
| You declined access on X (`x_connect_denied`) | Connect again and approve. |
| X didn't accept the callback / "Something went wrong" on X | The callback registered in the app must equal the one in Settings → X exactly (`http://127.0.0.1:<port>/callback`, no trailing slash). The app type must be Native App. |
| Set your X app's permissions to Read and write (`x_scopes_missing`) | Change the app's permissions, then connect again. |
| You signed in as @b, not @a | X used the account your browser is signed in to. Switch accounts on x.com, then Reconnect. |
| Reconnect @handle (`x_reconnect`) | The token was revoked, expired or can't be decrypted on this Mac. Reconnect from the account menu. |
| Out of X API credits (`x_credits`) | Add credits or raise the spending limit in the Developer Console. Your draft is kept; "Post it yourself" copies the text and exports the media. |
| Your X app doesn't have access to this (`x_access`) | The app is not enrolled for that endpoint. Check the app's access in the Developer Console. |
| Rate limited until HH:MM (`x_rate_limited`) | Wait until then; Try again stays blocked until the reset. |
| Media rejected (`x_media_rejected`) | X's own reason is shown. For images over 5 MB, export a JPEG from Media Studio. |
| X already has an identical post (`x_duplicate`) | X refuses exact duplicates of a recent post. Edit the text. |
| Not sure it posted (`x_uncertain`) | Open the sheet and "Check X". If X lags, check again in a minute before choosing Retry post. |

## Not verified from the build machine

T9 was built on Linux without an X developer app, so these were taken from
docs.x.com and are covered by the human's manual check:
- that X accepts `http://127.0.0.1:<fixed port>/callback` for a Native App;
- the exact wording of the duplicate-content 403 and the shape of an
  out-of-credits error (xBot also falls back to the HTTP status);
- that `attachments.media_keys` comes back on your own timeline right after a
  post, with the field list passed as `post.fields` (the current spec's name
  for what used to be `tweet.fields`).
