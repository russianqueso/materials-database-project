# Materials Explorer

## Local setup

Use Node.js 20 or newer.

```sh
npm install
cp .env.example .env
```

Set your Materials Project API key in `.env`:

```sh
MP_API_KEY=your-key
```

Note: `vercel dev` reads Serverless Function environment variables from `.env`, not `.env.local` — the latter is only used to store variables pulled from the Vercel dashboard via `vercel env pull`. Neither file is committed (see `.gitignore`).

Run the app and Vercel functions together:

```sh
npx vercel dev --yes
```

Note: Vercel CLI refuses to run if a `dev` script in `package.json` itself calls `vercel dev` (recursion guard), so this must be run directly rather than through `npm run dev`.

For a static-only preview, run:

```sh
npm run start
```

Run the test suite with:

```sh
npm test
```

## Deploy to Vercel

Add `MP_API_KEY` as an environment variable on the Vercel project before deploying, or the deployed API will return "Materials search is not configured":

```sh
npx vercel env add MP_API_KEY production
```

(repeat with `preview` and/or `development` if you want the key available in those environments too, or add it from the Vercel dashboard under Project Settings → Environment Variables). Do not commit `.env` or `.env.local` — both are gitignored.

Deploy from the repository root with:

```sh
npx vercel        # preview deployment
npx vercel --prod # production deployment
```

### Getting a friendly URL

Every project gets a free, stable alias at `https://<project-name>.vercel.app` (no Pro plan required) — use that instead of the deployment-specific URL with the random hash (e.g. `materials-database-project-30kjqfjxw-byteor.vercel.app`).

Two gotchas to know about, found while setting this up:

- **The bare `<project-name>.vercel.app` may not be available.** That subdomain is shared across all Vercel accounts; if someone else already has a project with the same name, yours silently falls back to `<project-name>-<team-slug>.vercel.app` instead. Hitting the unavailable bare URL returns Vercel's own `DEPLOYMENT_NOT_FOUND` page, not this app. Fix: rename to something more unique, or add a custom domain (also free on Hobby).
- **Deployment Protection can gate the friendly URL behind Vercel's SSO** even when a plain deployment URL or an older alias is public. If a URL returns a 302 to `vercel.com/sso-api` instead of the app, go to Project → Settings → Deployment Protection → Vercel Authentication and set the scope to exclude production (e.g. "Only Preview Deployments"), or turn it off. Also free on Hobby.

Renaming the project itself is dashboard-only (Settings → General → Project Name) — the CLI's `vercel project` command has no `rename` subcommand.
