# Static Vercel Materials Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Streamlit app with an instantly served static Materials Explorer and a private Vercel API, while preserving an interactive browser-side 3D crystal view.

**Architecture:** Vercel serves static files from `public/`; `api/materials.js` proxies and projects Materials Project results using the private `MP_API_KEY`. Browser JavaScript calls the same-origin API and lazy-loads Three.js only for structure rendering. Pure validation, projection, geometry, and DOM-state helpers are tested with Node's built-in runner.

**Tech Stack:** Node.js 20+, Vercel Functions, vanilla HTML/CSS/ES modules, Three.js CDN module, Node built-in test runner.

**Spec:** `docs/superpowers/specs/2026-09-02-static-vercel-materials-explorer-design.md`

## Global Constraints

- Do not commit any files; leave all changes uncommitted on `refactor/static-vercel-poc`.
- Keep `MP_API_KEY` only in `.env.local` locally and Vercel environment settings in production.
- Serve the landing page as static files and make no Materials Project request until a search action.
- Use `GET /api/materials?q=<formula-or-mp-id>` as the sole data interface.
- Render one unit cell with atoms and edges in the browser; do not add a Python runtime or server-side structure transformation.
- Use Vercel's Hobby-compatible serverless and static deployment model.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `package.json` | Scripts and development dependency declarations. |
| `vercel.json` | Vercel static/API routing and framework-independent settings. |
| `.gitignore` | Excludes Node output and local secrets. |
| `.env.example` | Documents the required key name without a value. |
| `README.md` | Local setup, test, and Vercel deployment instructions. |
| `api/materials.js` | Vercel request handler and HTTP response mapping. |
| `lib/materials.js` | Query validation, upstream URL construction, and browser-safe response projection. |
| `public/index.html` | Semantic static page shell. |
| `public/styles.css` | Minimal responsive POC styling. |
| `public/app.js` | Search UI, result rendering, API calls, and lazy 3D-render orchestration. |
| `public/structure-viewer.js` | Three.js loading, lattice conversion, unit-cell construction, and cleanup. |
| `test/materials.test.js` | Unit tests for server-side pure helpers. |
| `test/structure-viewer.test.js` | Unit tests for geometry helpers. |
| `test/app.test.js` | DOM-state tests using a small fake document. |

### Task 1: Establish the Node/Vercel project shell

**Files:**
- Create: `package.json`
- Create: `vercel.json`
- Create: `.env.example`
- Create or modify: `.gitignore`
- Create: `README.md`

**Interfaces:**
- Consumes: `MP_API_KEY` from `.env.local` or Vercel environment settings.
- Produces: `npm run dev`, `npm run start`, and `npm test` commands for later tasks.

- [ ] **Step 1: Add a failing scripts test**

Create `test/project-shell.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package exposes development and test scripts', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
  assert.ok(packageJson.scripts.dev);
  assert.ok(packageJson.scripts.start);
  assert.equal(packageJson.scripts.test, 'node --test');
});

test('README documents local Vercel development and the key name', async () => {
  const readme = await readFile('README.md', 'utf8');
  assert.match(readme, /npm run dev/);
  assert.match(readme, /MP_API_KEY/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- test/project-shell.test.js`

Expected: FAIL because `package.json` does not exist.

- [ ] **Step 3: Create the local and deployment shell**

Create `package.json` with these scripts:

```json
{
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "dev": "vercel dev",
    "start": "serve public",
    "test": "node --test"
  },
  "devDependencies": {
    "serve": "^14.2.4",
    "vercel": "^48.0.0"
  }
}
```

Create `.env.example` containing `MP_API_KEY=`. Add `.env.local` and `node_modules/` to `.gitignore`. Create `vercel.json` so Vercel serves `public/` and recognizes `api/` functions. Write README instructions for `npm install`, copying `.env.example` to `.env.local`, `npm run dev`, `npm run start`, `npm test`, adding `MP_API_KEY` in Vercel, and deploying with `npx vercel`.

- [ ] **Step 4: Run the shell test and install dependencies**

Run: `npm install && npm test -- test/project-shell.test.js`

Expected: PASS. `npm run dev` is now available locally.

- [ ] **Step 5: Verify no secret file is tracked**

Run: `git check-ignore .env.local && git status --short`

Expected: `.env.local` is ignored and all intended project changes remain uncommitted.

### Task 2: Implement the private Materials Project API

**Files:**
- Create: `lib/materials.js`
- Create: `api/materials.js`
- Create: `test/materials.test.js`

**Interfaces:**
- Consumes: `GET` request, `q` URL parameter, `process.env.MP_API_KEY`, and global `fetch`.
- Produces: `validateQuery(query)`, `buildSearchUrl(query)`, `projectMaterial(doc)`, `projectResults(docs)`, and default Vercel handler `(request, response) => Promise<void>`.

- [ ] **Step 1: Write failing pure-helper tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateQuery, projectMaterial } from '../lib/materials.js';

test('accepts formulas and Materials Project IDs', () => {
  assert.deepEqual(validateQuery('SiO2'), { ok: true, value: 'SiO2' });
  assert.deepEqual(validateQuery(' mp-149 '), { ok: true, value: 'mp-149' });
});

test('rejects missing and unsupported queries', () => {
  assert.equal(validateQuery(' ').ok, false);
  assert.equal(validateQuery('<script>').ok, false);
});

test('projects a summary document without exposing upstream fields', () => {
  const result = projectMaterial({ material_id: 'mp-149', formula_pretty: 'Si', structure: null });
  assert.deepEqual(result, {
    materialId: 'mp-149', formula: 'Si', properties: {}, structure: null
  });
});
```

- [ ] **Step 2: Run the helper tests to verify failure**

Run: `npm test -- test/materials.test.js`

Expected: FAIL because `lib/materials.js` does not exist.

- [ ] **Step 3: Implement validation and safe response projection**

In `lib/materials.js`, keep the Materials Project endpoint and requested field list in module constants. Build the request URL with `URL` and `URLSearchParams`; use `material_ids` for an `mp-<digits>` query and `formula` otherwise. Project exactly the documented IDs, core values, symmetry fields, element symbols, and lattice plus site species/fractional coordinates. Return `null` structure if any required structure component is unavailable. Cap `projectResults` at ten non-deprecated records.

In `api/materials.js`, reject non-GET requests with 405 and invalid queries with 400. Require `MP_API_KEY`, call upstream with `X-API-KEY`, abort after ten seconds, and map no matches to 404 and fetch/parse failures to user-safe 503/502 JSON errors. Set JSON content type and `Cache-Control: public, max-age=300, s-maxage=3600` on successful responses.

- [ ] **Step 4: Run all API unit tests**

Run: `npm test -- test/materials.test.js`

Expected: PASS, including validation, request shape, projection, result limit, and error response tests.

- [ ] **Step 5: Exercise the handler locally without a secret**

Run: `node --input-type=module -e "import('./api/materials.js').then(({default: handler}) => console.log(typeof handler))"`

Expected: prints `function`; no key value is printed.

### Task 3: Build and test the static search experience

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`
- Create: `test/app.test.js`

**Interfaces:**
- Consumes: `GET /api/materials?q=<encoded query>` response defined in Task 2.
- Produces: `searchMaterials(query, fetchImpl)`, `formatValue(value, options)`, `renderMaterial(result)`, and `setStatus(message, kind)`.

- [ ] **Step 1: Write failing UI-helper tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { formatValue, searchMaterials } from '../public/app.js';

test('formats missing values as an em dash', () => {
  assert.equal(formatValue(null), '—');
});

test('search calls the same-origin API with an encoded query', async () => {
  let requestedUrl;
  await searchMaterials('LiFePO4', async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ results: [] }) };
  });
  assert.equal(requestedUrl, '/api/materials?q=LiFePO4');
});
```

- [ ] **Step 2: Run the UI-helper tests to verify failure**

Run: `npm test -- test/app.test.js`

Expected: FAIL because `public/app.js` does not exist.

- [ ] **Step 3: Implement the accessible static page and client state**

Create semantic markup with a title, search form, `aria-live` status element, popular material buttons, an empty result panel, and a results selector hidden by default. Style it with a responsive single-column POC layout, clear button focus indicators, readable property grid, and a fixed-height 3D container.

In `public/app.js`, attach form and shortcut events after `DOMContentLoaded`. Disable the submit control while `searchMaterials` runs, clear old result and viewer state before each request, show a loading message, map API error JSON to a visible message, and re-enable the form in `finally`. Render only DOM-created text nodes for API-provided values. Expose the three pure helpers as named exports and guard browser-only initialization with `if (typeof document !== 'undefined')`.

- [ ] **Step 4: Run the UI tests**

Run: `npm test -- test/app.test.js`

Expected: PASS for URL encoding, missing values, loading transition, empty-result handling, and server-error message mapping.

- [ ] **Step 5: Preview static assets locally**

Run: `npm run start`

Expected: static site starts; opening the reported local URL shows the search UI without triggering an API request.

### Task 4: Add lazy browser-side 3D unit-cell rendering

**Files:**
- Create: `public/structure-viewer.js`
- Modify: `public/app.js`
- Modify: `public/styles.css`
- Create: `test/structure-viewer.test.js`

**Interfaces:**
- Consumes: `structure` object from Task 2: `{ lattice: number[][], sites: Array<{ element: string, fractional: number[] }> }`.
- Produces: `fractionalToCartesian(fractional, lattice)`, `unitCellEdges(lattice)`, `renderStructure(container, structure)`, and `disposeStructureViewer()`.

- [ ] **Step 1: Write failing geometry tests**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { fractionalToCartesian, unitCellEdges } from '../public/structure-viewer.js';

test('converts fractional coordinates with lattice row vectors', () => {
  assert.deepEqual(fractionalToCartesian([0.5, 0.5, 0.5], [[2, 0, 0], [0, 4, 0], [0, 0, 6]]), [1, 2, 3]);
});

test('returns the twelve unit-cell edges', () => {
  assert.equal(unitCellEdges([[1, 0, 0], [0, 1, 0], [0, 0, 1]]).length, 12);
});
```

- [ ] **Step 2: Run the geometry tests to verify failure**

Run: `npm test -- test/structure-viewer.test.js`

Expected: FAIL because `public/structure-viewer.js` does not exist.

- [ ] **Step 3: Implement lazy Three.js rendering**

In `public/structure-viewer.js`, keep lattice calculations independent of Three.js and export them for tests. Dynamically import `three.module.js` and `OrbitControls.js` from the same pinned CDN release inside `renderStructure`. Convert every site once with `fractionalToCartesian`, build color-coded sphere meshes, draw the twelve edges, fit the camera to the lattice size, add orbit controls, and dispose renderer, controls, geometries, materials, and canvas before rendering a new structure. Return a user-safe no-structure message without importing Three.js if structure is null or invalid.

Update `public/app.js` to call `renderStructure` after rendering a result and `disposeStructureViewer` before a new request or result selection. Update CSS for a responsive, visible viewer canvas.

- [ ] **Step 4: Run geometry and complete test suites**

Run: `npm test`

Expected: PASS for every test file.

- [ ] **Step 5: Perform local manual smoke tests**

Run: `npm run dev`

Expected: Vercel Dev reports a local URL. In a browser with `.env.local` configured, verify `SiO2`, `mp-149`, invalid input, an unknown ID, a structure-less record, popular buttons, result selector, and orbit/zoom controls. Stop the dev server afterward.

### Task 5: Final deployment readiness review

**Files:**
- Modify: `README.md`
- Modify: `vercel.json` only if the verified local route differs from documented route.

**Interfaces:**
- Consumes: completed static client, API, and test suite.
- Produces: documented, reproducible Vercel deployment instructions.

- [ ] **Step 1: Complete the concise README**

Document Node version, installation, `.env.local`, static preview, Vercel Dev, test command, setting `MP_API_KEY` in the Vercel dashboard, and `npx vercel` deployment. State explicitly that no key should be committed.

- [ ] **Step 2: Run final automated verification**

Run: `npm test`

Expected: PASS with no skipped or focused tests.

- [ ] **Step 3: Inspect final state without committing**

Run: `git diff --check && git status --short`

Expected: no whitespace errors; all implementation and documentation files are visible as uncommitted changes on `refactor/static-vercel-poc`.
