# Review API contract

`client/review.js` works with any backend that implements the six routes below. The kit ships three backends (`servers/node`, `servers/php`, `servers/cloudflare`). To use something else, such as Django, Rails, Laravel, Go, Supabase Edge Functions, Netlify or Vercel functions, or an existing Express app, implement these routes and point `data-api` at them.

The test script `tests/contract.mjs` checks a backend against this contract:

```bash
node tests/contract.mjs http://localhost:8787/api your-passcode
```

## Basics

- **Base URL**: whatever you set as `data-api`, for example `https://example.com/api`. The routes below are relative to it.
- **Auth**: every request carries the header `x-review-key: <passcode>`. Compare it with the server's passcode after trimming spaces and ignoring case, using a constant-time comparison.
  - Wrong or missing passcode: respond `401 {"error": "Wrong passcode"}`. Waiting about 800 ms before responding slows down guessing.
  - No passcode configured on the server: respond `503 {"error": "Review is not configured"}`.
- **Format**: JSON request and response bodies. Send `cache-control: no-store`.
- **CORS**, needed only when the API is on a different origin from the website. If the request's `Origin` header is in your allow-list, reply with:
  - `access-control-allow-origin: <that origin>`
  - `access-control-allow-methods: GET, POST, PATCH, DELETE, OPTIONS`
  - `access-control-allow-headers: content-type, x-review-key`
  - `vary: Origin`

  Answer `OPTIONS` preflight requests with `204`, before checking the passcode.

## Routes

| Method and path | Body | Response |
|---|---|---|
| `GET /auth` | | `200 {"ok": true}`. The client uses this to check the passcode. |
| `GET /items?page=/about` | | `200 [Item, …]`: the items on that page that aren't deleted, oldest first |
| `GET /items?all=1` | | `200 [Item, …]`: every item that isn't deleted, on every page, oldest first |
| `POST /items` | `{"page": "/about", "item": {…}}` | `201 Item` |
| `PATCH /items/{id}` | Any of `{"text": "…"}`, `{"resolved": true}` or `{"reply": {"author": "…", "text": "…"}}` | `200 Item`, or `404` |
| `DELETE /items/{id}` | | `200 {"ok": true}` |

## Item

```json
{
  "id": "uuid", "page": "/about", "created": 1730000000000, "updated": 1730000000000,
  "type": "pin",
  "anchor": { "sel": "body > section:nth-of-type(2)", "fx": 0.42, "fy": 0.13 },
  "points": [[0.1, 0.2], [0.3, 0.4]],
  "color": "#e5484d",
  "text": "Make this heading bigger",
  "author": "Sam",
  "vw": 1440,
  "resolved": false,
  "replies": [{ "author": "Alex", "text": "Done", "created": 1730000000000 }]
}
```

`created`, `updated` and `replies[].created` are times in milliseconds since the Unix epoch.

## Cleaning what the client sends

Never store the client's object as it arrives. Keep only the fields below, set your own `id` and timestamps, and set `resolved: false` and `replies: []` on create.

| Field | Rule |
|---|---|
| `type` | Must be `pin`, `draw` or `box`. Respond `400` otherwise. |
| `anchor.sel` | String, cut to 400 characters |
| `anchor.fx`, `anchor.fy` | Finite numbers, otherwise 0 |
| `points` | At most 2000 `[x, y]` pairs of finite numbers |
| `color` | Must match `#rrggbb`, otherwise `#e5484d` |
| `text` | String, cut to 4000 characters |
| `author` | String, cut to 60 characters, `Anonymous` if empty |
| `vw` | Integer from 0 to 10000 |

For a PATCH:

- Only `text` (cut to 4000 characters) and `resolved` (boolean) can be changed.
- A `reply` with non-empty `text` is appended as `{author, text, created}`. Cut `author` to 60 characters and `text` to 4000. Keep at most 200 replies.

## Page keys

Normalise `page` before storing or querying it:

1. Remove the query string and `#` fragment, and cut it to 200 characters.
2. Change `""` and `/index.html` to `/`.
3. Remove a trailing `.html`.

The client sends the same form. Deleting an item can be a soft delete, where the item stays in storage but is flagged as deleted. The kit's backends do this.
