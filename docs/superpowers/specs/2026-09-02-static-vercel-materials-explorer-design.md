# Static Vercel Materials Explorer Design

## Goal

Replace the Streamlit application with a minimal, static-first proof of concept. The landing page must load without starting Python or downloading scientific Python packages; a Vercel serverless API keeps the Materials Project API key private and supplies data only after a user searches.

## Scope

- Preserve formula and Materials Project ID searches.
- Preserve the popular-material shortcuts and random-material action.
- Preserve a browser-rendered 3D crystal visualization with atoms and unit-cell edges.
- Preserve the core material properties and a compact element summary.
- Provide clear pending, empty-result, malformed-query, upstream-error, and unavailable-structure states.

The POC intentionally excludes Streamlit, Plotly, Python, server-side crystal transformations, isotope tables, authentication, persistence, analytics, and a production design system. Short-lived HTTP caching of successful public material results is included to reduce repeated upstream calls.

## Architecture

Vercel serves `public/index.html`, `public/styles.css`, and `public/app.js` as static assets. The initial page contains the search and popular-material controls but does not load the 3D renderer. After a successful search, `app.js` dynamically imports a CDN-hosted Three.js module and renders the returned structure into the result area.

One Vercel Node.js function, `api/materials.js`, accepts `GET /api/materials?q=<formula-or-mp-id>`. It validates the query, calls the Materials Project summary API using `MP_API_KEY`, projects the response to an explicit browser-safe schema, and returns JSON. The key remains an environment variable in Vercel and is never included in static files or API responses.

## API Contract

### Request

`GET /api/materials?q=SiO2`

The `q` parameter is required, trimmed, limited to 100 characters, and must be either a Materials Project ID matching `mp-<digits>` or a formula containing letters, digits, parentheses, periods, and `+`/`-` signs. Invalid requests receive HTTP 400.

### Successful response

```json
{
  "results": [
    {
      "materialId": "mp-149",
      "formula": "Si",
      "properties": {
        "bandGapEv": 0.62,
        "densityGcm3": 2.33,
        "volumeA3": 40.05,
        "energyAboveHullEvAtom": 0,
        "formationEnergyEvAtom": -0.54,
        "isStable": true,
        "crystalSystem": "Cubic",
        "spaceGroup": "Fd-3m",
        "spaceGroupNumber": 227,
        "elements": ["Si"]
      },
      "structure": {
        "lattice": [[0, 2.7, 2.7], [2.7, 0, 2.7], [2.7, 2.7, 0]],
        "sites": [{"element": "Si", "fractional": [0, 0, 0]}]
      }
    }
  ]
}
```

The function returns only a maximum of ten non-deprecated results. `structure` may be `null` when no structure exists. It returns HTTP 404 for no matches, HTTP 502 for an unusable Materials Project response, and HTTP 503 when the upstream request fails or times out. Error responses use `{ "error": "short user-safe message" }`.

## Client Behavior

The search form and shortcut buttons call the API through one `searchMaterials(query)` function. The first result is shown immediately; a selector appears only when multiple results are returned. Every new search clears prior results and any previous 3D canvas.

The material view displays the formula, material ID, a compact grid of numeric properties, stability, symmetry, and listed elements. The client uses `Intl.NumberFormat` for numeric output and displays an em dash for null values.

`renderStructure(container, structure)` builds atoms from fractional coordinates and lattice vectors, draws a single unit-cell wireframe, adds orbit controls, and provides an accessible textual fallback when WebGL or structure data is unavailable. It uses a small built-in CPK color map with a neutral fallback color. For this POC it renders one unit cell, not a 3x3x3 supercell and not bonds.

## Error Handling and Security

The browser never sends or stores `MP_API_KEY`. The API permits only `GET`, adds a conservative `Cache-Control: public, max-age=300, s-maxage=3600` header to successful results, uses a ten-second upstream timeout, and does not expose upstream error bodies. The client disables the submit button during requests, announces state through an `aria-live` status element, and leaves the form usable after errors.

## Deployment

The repository root is deployed to Vercel. `vercel.json` configures the static public directory and rewrites `/api/materials` to the serverless function if needed. Vercel project settings provide `MP_API_KEY`; `.env.example` documents only the variable name. The site can use a Vercel-provided domain for the POC.

## Local Development

The project includes `package.json` with `dev`, `test`, and `start` scripts. `npm install` installs the small development toolchain, and `npm run dev` starts `vercel dev`, which serves the static files and the `api/materials.js` function together on one local origin. This makes browser requests to `/api/materials` behave the same way locally and after deployment, without CORS configuration or a separate Python process.

Developers create `.env.local` from `.env.example` and set their own `MP_API_KEY`; `.env.local` is ignored by Git. `npm run start` provides a static-only preview for checking the initial page without API searches. The README documents prerequisites (current Node.js LTS, npm, and optionally the Vercel CLI), the copy-and-configure step, local commands, tests, and deployment commands.

## Testing

Use Node's built-in test runner to test query validation, response projection, error mapping, and the pure lattice-coordinate helpers. Browser-independent client tests cover loading and result-state DOM transitions. A manual smoke test verifies a popular-material search, a material-ID search, no result, malformed query, upstream failure, and WebGL rendering on a desktop browser.

## Acceptance Criteria

- Opening the site loads the search UI before any Materials Project request is made.
- Searching a valid formula or `mp-` ID returns core properties through the private API.
- The browser displays an interactive 3D unit-cell model when structure data exists.
- The Materials Project key appears only in Vercel environment configuration.
- The project deploys on Vercel's Hobby tier without a persistent server.
- A developer can run `npm install`, copy `.env.example` to `.env.local`, set `MP_API_KEY`, and run `npm run dev` to test both the page and `/api/materials` locally.
