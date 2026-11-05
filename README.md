# Site Review Kit

Lets clients review a website you built, right on the live site. They press **Review**, enter a passcode, and can:

- pin comments anywhere on the page
- draw on the page or drag a highlight box around an area
- reply to comments, and resolve, reopen or delete them
- see every page's open feedback in a side panel, and download all of it as a CSV

Everyone with the passcode sees the same feedback, and it refreshes every 15 seconds. Each comment records who wrote it and how wide their screen was.

Keyboard shortcuts in review mode: **V** browse, **C** comment, **D** draw, **B** box, **Esc** cancel.

**It works with any website and any host.** The front end is one JavaScript file and one CSS file with no dependencies or build step. Comments are saved by a small backend, and you choose which one:

| Backend | Use it when | Needs |
|---|---|---|
| [**PHP**](#php-shared-hosting-cpanel-wordpress-hosts) | The site is on ordinary web hosting (cPanel, Hostinger, SiteGround, GoDaddy, Bluehost, or a WordPress host) | PHP 7.4+ with SQLite, which nearly every host has. **Not yet tested, see below.** |
| [**Node.js**](#nodejs-vps-render-railway-fly-docker-or-your-own-app) | You have a VPS or a Node host (Render, Railway, Fly.io, DigitalOcean), use Docker, or want to add it to an existing Express app | Node 18+, with no npm packages |
| [**Cloudflare**](#cloudflare-pages--d1) | You want free serverless hosting, or the site is already on Cloudflare Pages | A Cloudflare account |
| [**Your own**](docs/API.md) | You use Django, Rails, Laravel, Go, Supabase, Vercel or Netlify functions, or anything else | Six small routes, described in [docs/API.md](docs/API.md) |

The Node.js and Cloudflare backends pass the full test suite (`tests/contract.mjs`). The PHP backend follows the same contract but **hasn't been run against the test suite yet**. If you use it, please run the test first (see [Any other backend](#any-other-backend)), and open an issue if anything fails.

## Get the kit

```bash
git clone https://github.com/hjmaxwong/site-review-kit.git
cd site-review-kit
```

Or press **Code → Download ZIP** on GitHub.

## Try it in one minute

You need [Node.js](https://nodejs.org) 18 or newer. Nothing else gets installed.

macOS or Linux:

```bash
REVIEW_PASSCODE=change-me node servers/node/server.js
```

Windows (PowerShell):

```powershell
$env:REVIEW_PASSCODE="change-me"; node servers/node/server.js
```

Open http://localhost:8787/demo, press **Review**, enter `change-me`, and leave a comment.

## Install on a site

Each setup has the same two parts: run a backend, then add the script to the site's pages. Use **one backend per client site**. Comments are stored by page path, so two sites sharing one backend would mix their feedback.

### PHP (shared hosting, cPanel, WordPress hosts)

> **Untested:** this backend hasn't been run against `tests/contract.mjs` yet. Test it on a staging site before you give it to a client.

1. Copy `client/review.js` and `client/review.css` into `servers/php/review/`.
2. Copy `servers/php/review/api/config.example.php` to `config.php` in the same folder, and set your `passcode`.
3. Upload the whole `review/` folder to the site's web root, for example with the cPanel File Manager or FTP. You end up with `https://client.com/review/`.
4. Make sure PHP can write to `review/api/data/`. On most hosts it already can. If it can't, set the folder's permissions to 775.
5. Add this to every page, just before `</body>`:
   ```html
   <script src="/review/review.js" data-api="/review/api" defer></script>
   ```
   On WordPress, put it in the theme's `footer.php`, or use a plugin that adds code to the footer, such as WPCode.

If the host doesn't support `.htaccess` rewrites (nginx hosts often don't), use `data-api="/review/api/index.php"` instead. On nginx, also block public access to `review/api/data/`. Better still, set `db` in `config.php` to a folder outside the web root.

### Node.js (VPS, Render, Railway, Fly, Docker, or your own app)

**Standalone:** deploy the repo to any Node host with the start command `node servers/node/server.js` and these environment variables:

| Variable | Value |
|---|---|
| `REVIEW_PASSCODE` | The reviewers' passcode (required) |
| `ALLOWED_ORIGINS` | The client site's address(es), comma-separated, for example `https://client.com,https://www.client.com` |
| `DATA_FILE` | Where the comments file goes. Point it at a **persistent disk**: many hosts wipe local files on redeploy. The default is `servers/node/data/review.json`. |
| `PORT` | Usually set by the host. The default is 8787. |

Then add one line to the client's site:

```html
<script src="https://your-review-server.com/review.js" defer></script>
```

The script loads its CSS and finds the API (`/api`) on the same server by itself.

**Docker:**

```bash
docker build -f servers/node/Dockerfile -t site-review .
docker run -p 8787:8787 -e REVIEW_PASSCODE=change-me -e ALLOWED_ORIGINS=https://client.com -v review-data:/app/data site-review
```

**Inside an existing Express or Connect app**, on the same domain as the site, so no CORS is needed:

```js
const { createReviewHandler } = require('./servers/node/server.js');
app.use('/api', createReviewHandler({ passcode: process.env.REVIEW_PASSCODE, dataFile: './data/review.json' }));
app.use(express.static('client')); // or copy review.js and review.css into your static folder
```

Then add `<script src="/review.js" defer></script>` to your layout. If `/api` is already used, mount the handler somewhere else and set `data-api` to match.

### Cloudflare Pages + D1

Free and serverless. You need `npx wrangler@4 login` once. Run everything from `servers/cloudflare/`:

```bash
cd servers/cloudflare
# Edit wrangler.toml: set `name` (for example acme-review)
npx wrangler@4 d1 create acme-review                 # paste the database_id it prints into wrangler.toml
npx wrangler@4 d1 execute acme-review --remote --file=schema.sql
cp ../../client/review.js ../../client/review.css public/
npx wrangler@4 pages project create acme-review --production-branch=main
npx wrangler@4 pages secret put REVIEW_PASSCODE --project-name=acme-review
npx wrangler@4 pages secret put ALLOWED_ORIGINS --project-name=acme-review
npx wrangler@4 pages deploy --project-name=acme-review --branch=main
```

Then add to the client's site:

```html
<script src="https://acme-review.pages.dev/review.js" defer></script>
```

If the site itself is a Cloudflare Pages project, you can copy `functions/` into it and add the D1 binding instead. That puts the API on the same domain, so you don't need `ALLOWED_ORIGINS`.

Local test: copy `.dev.vars.example` to `.dev.vars`, run the `d1 execute` line with `--local` instead of `--remote`, and run `npx wrangler@4 pages dev`.

### Any other backend

Implement the six routes in [docs/API.md](docs/API.md), then test them:

```bash
node tests/contract.mjs https://your-api.example.com/api your-passcode https://your-site.example.com
```

## Script options

Put these on the script tag as `data-*` attributes, or set them in `window.SiteReviewConfig = {...}` before the script loads.

| Attribute | Default | Use |
|---|---|---|
| `data-api` | `/api`, or `api/` next to the script when it's loaded from another domain | The backend's base URL |
| `data-team` | `the website team` | Shown in the passcode prompt ("Review mode is for …") |
| `data-label` | `Review` | The text on the floating button |
| `data-reveal` | none | Forces scroll-reveal animations to show in review mode, for example `.reveal:is-in` adds `is-in` to every `.reveal` |
| `data-css` | auto | Set to `none` to stop it loading `review.css` automatically |

The page also fires `sitereview:enter` and `sitereview:exit` events on `document`, and adds the `rv-on` class to `<html>` while review mode is on. You can use these to pause carousels, show hidden content, or move a sticky nav. To change the font, set `--rv-font` on `:root`.

## Sharing with a client

Send them the site link with `?review=1` on the end (for example `https://client.com/?review=1`) and the passcode. That link opens review mode straight away. After that, the **Review** and **Live view** button switches between review mode and the normal site.

## Reading the feedback

- **In the browser:** open the side panel (the list icon) and press **Download all feedback (CSV)**.
- **From the terminal**, on any backend:
  ```bash
  curl -s -H "x-review-key: $REVIEW_PASSCODE" "https://your-review-server.com/api/items?all=1"
  ```
- **With Claude Code:** see the next section.

## Use it with Claude Code (optional)

This repo is also a Claude Code skill. Once it's installed, you can ask Claude to "add the review kit to this site" or "read the review comments and fix them", and it follows [SKILL.md](SKILL.md).

macOS or Linux:

```bash
git clone https://github.com/hjmaxwong/site-review-kit.git ~/.claude/skills/site-review-kit
```

Windows (PowerShell):

```powershell
git clone https://github.com/hjmaxwong/site-review-kit.git "$HOME\.claude\skills\site-review-kit"
```

Restart Claude Code. Read through `SKILL.md` before you install it, as you would for any skill.

## Repository layout

| Path | What it is |
|---|---|
| `client/` | `review.js` and `review.css`: the review UI. Every class name starts with `rv-`, so it won't clash with the site's own styles. |
| `servers/php/` | The PHP + SQLite backend (`review/api/index.php`). |
| `servers/node/` | The Node.js backend (`server.js`, zero dependencies) and a Dockerfile. |
| `servers/cloudflare/` | The Cloudflare Pages Functions + D1 backend. |
| `docs/API.md` | The API contract for writing your own backend. |
| `tests/contract.mjs` | Checks any backend against that contract. |
| `demo/` | The demo page. |
| `SKILL.md` | Instructions for Claude Code. |

## Security and limits

- The passcode protects the API, but anyone who has it can read, edit and delete feedback. Don't put sensitive information in comments.
- Pins are attached to the element they were dropped on. If you change a section heavily, the pin may move or fall back to the top of the page.
- Deleting a comment only hides it. The data stays in storage, marked as deleted.
- Before launch, remove the script tag, or leave it in if the client wants to keep giving feedback. Visitors only see a small **Review** button, and nothing loads without the passcode.

## License

MIT. See [LICENSE](LICENSE).
