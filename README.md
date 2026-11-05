# Site Review Kit

Lets clients review a website you built, right on the live site. They press **Review**, enter a passcode, and can:

- pin comments anywhere on the page
- draw on the page or drag a highlight box around an area
- reply to comments, and resolve, reopen or delete them
- see every page's open feedback in a side panel, and download all of it as a CSV

Comments are shared: everyone with the passcode sees the same feedback, and it refreshes every 15 seconds. Each comment records who wrote it and how wide their screen was.

Keyboard shortcuts in review mode: **V** browse, **C** comment, **D** draw, **B** box, **Esc** cancel.

It's free to host. The comments are stored in a Cloudflare D1 database on Cloudflare's free plan, and the front end is one JavaScript file and one CSS file with no dependencies.

## Get the kit

```bash
git clone https://github.com/hjmaxwong/site-review-kit.git
cd site-review-kit
```

Or press **Code → Download ZIP** on GitHub.

### Use it with Claude Code (optional)

The repo also works as a Claude Code skill. Once it's installed, you can ask Claude to "add the review kit to this site" or "read the review comments and fix them", and it follows `SKILL.md`.

macOS or Linux:

```bash
git clone https://github.com/hjmaxwong/site-review-kit.git ~/.claude/skills/site-review-kit
```

Windows (PowerShell):

```powershell
git clone https://github.com/hjmaxwong/site-review-kit.git "$HOME\.claude\skills\site-review-kit"
```

Restart Claude Code, and `site-review-kit` appears in its skills list. Read through `SKILL.md` before you install it, as you would for any skill.

## Try it locally in 2 minutes

```bash
cd server
cp .dev.vars.example .dev.vars             # sets the local passcode to "change-me"
cp ../client/review.js ../client/review.css public/
npx wrangler@4 d1 execute my-site-review --local --file=schema.sql
npx wrangler@4 pages dev --port 8788
```

Open http://localhost:8788/demo, press **Review**, enter `change-me`, and leave a comment.

Before you deploy a real review API, delete `public/demo.html` if you don't want the demo page to be public.

## What's in the folder

| Path | What it is |
|---|---|
| `client/review.js`, `client/review.css` | The review mode UI. Plain JavaScript and CSS with no dependencies. Every class name starts with `rv-`, so it won't clash with the site's own styles. |
| `server/` | The comments API: Cloudflare Pages Functions plus a D1 (SQLite) database. It runs on Cloudflare's free plan. |
| `server/schema.sql` | The database table. |
| `server/public/demo.html` | A demo page for trying the kit locally. |
| `SKILL.md` | Instructions that let Claude Code install the kit on a new site. |

## Setup

You need a Cloudflare account and Node.js (for `npx wrangler`). Run `npx wrangler@4 login` once.

There are two ways to set it up. Pick one for each client.

### Option A: hosted API, which works with any website (WordPress, Webflow, Squarespace, Netlify, anything)

The API gets its own small Cloudflare Pages project, and the site adds one script tag.

```bash
cd server
# 1. Edit wrangler.toml and set `name` (for example acme-review)
npx wrangler@4 d1 create acme-review            # paste the database_id it prints into wrangler.toml
npx wrangler@4 d1 execute acme-review --remote --file=schema.sql
cp ../client/review.js ../client/review.css public/
npx wrangler@4 pages project create acme-review --production-branch=main
npx wrangler@4 pages secret put REVIEW_PASSCODE --project-name=acme-review
npx wrangler@4 pages secret put ALLOWED_ORIGINS --project-name=acme-review   # e.g. https://acme.com,https://www.acme.com
npx wrangler@4 pages deploy --project-name=acme-review --branch=main
```

Then add this line to every page of the client's site, just before `</body>`:

```html
<script src="https://acme-review.pages.dev/review.js" defer></script>
```

The script loads its own CSS and finds the API from its own URL.

### Option B: same project, for sites already hosted on Cloudflare Pages

1. Copy `server/functions/` into the site's project root, and copy `client/review.js` and `client/review.css` into the site's assets.
2. Add the D1 binding (`[[d1_databases]]`, binding `DB`) to the site's `wrangler.toml`, then create the database and run the schema as shown in Option A.
3. Add to each page:
   ```html
   <link rel="stylesheet" href="/assets/review.css">
   <script src="/assets/review.js" defer></script>
   ```
4. Set the `REVIEW_PASSCODE` secret and deploy. You don't need `ALLOWED_ORIGINS`.

## Options

Put these on the script tag as `data-*` attributes, or set them in `window.SiteReviewConfig = {...}` before the script loads.

| Attribute | Default | Use |
|---|---|---|
| `data-api` | `/api`, or the script's own domain + `/api` | The API base URL |
| `data-team` | `the website team` | Shown in the passcode prompt ("Review mode is for …") |
| `data-label` | `Review` | The text on the floating button |
| `data-reveal` | none | Forces scroll-reveal animations to show in review mode, for example `.reveal:is-in` adds `is-in` to every `.reveal` |
| `data-css` | auto | Set to `none` to stop it loading `review.css` automatically |

The page also fires `sitereview:enter` and `sitereview:exit` events on `document`. You can use them to pause carousels, show hidden content, or move a sticky nav.

## Sharing with a client

Send them the site link with `?review=1` on the end (for example `https://acme.com/?review=1`) and the passcode. That link opens review mode straight away. After that, the **Review** and **Live view** button switches between review mode and the normal site.

## Reading the feedback

- **In the browser:** open the side panel (the list icon) and press **Download all feedback (CSV)**.
- **From the terminal:**
  ```bash
  npx wrangler@4 d1 execute acme-review --remote --command "SELECT page, data FROM items WHERE deleted = 0"
  ```
- **With Claude Code:** say "read the review comments and fix them". `SKILL.md` covers this.

## Changing the passcode

```bash
npx wrangler@4 pages secret put REVIEW_PASSCODE --project-name=acme-review
```

Then redeploy. Anyone using the old passcode is asked for the new one.

## Removing it at launch

Delete the script tag, or the `<link>` and `<script>` lines. Keep the API project if you want to keep the comment history.

## Notes and limits

- Use one API project and database per client site. Comments are stored by page path, so two sites sharing one database would mix their feedback.
- Pins are attached to the element they were dropped on. If you change a section heavily, the pin may move or fall back to the top of the page.
- Deleting a comment only hides it. The row stays in the database with `deleted = 1`.
- The passcode protects the API, but anyone who has it can read, edit and delete feedback. Don't put sensitive information in comments.

## License

MIT. See [LICENSE](LICENSE).
