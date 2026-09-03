import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/materials.js';
import {
  buildSearchUrl,
  projectMaterial,
  projectResults,
  validateQuery,
} from '../lib/materials.js';

const originalFetch = globalThis.fetch;
const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
const originalApiKey = process.env.MP_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.setTimeout = originalSetTimeout;
  globalThis.clearTimeout = originalClearTimeout;
  if (originalApiKey === undefined) {
    delete process.env.MP_API_KEY;
  } else {
    process.env.MP_API_KEY = originalApiKey;
  }
});

function createResponse() {
  return {
    statusCode: undefined,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

async function invoke(request) {
  const response = createResponse();
  await handler(request, response);
  return response;
}

test('accepts formulas and Materials Project IDs', () => {
  assert.deepEqual(validateQuery('SiO2'), { ok: true, value: 'SiO2' });
  assert.deepEqual(validateQuery('LiFePO4'), { ok: true, value: 'LiFePO4' });
  assert.deepEqual(validateQuery('Ca(OH)2'), { ok: true, value: 'Ca(OH)2' });
  assert.deepEqual(validateQuery('Fe0.5Co0.5O'), { ok: true, value: 'Fe0.5Co0.5O' });
  assert.deepEqual(validateQuery('Na+'), { ok: true, value: 'Na+' });
  assert.deepEqual(validateQuery(' mp-149 '), { ok: true, value: 'mp-149' });
});

test('rejects missing and unsupported queries', () => {
  assert.equal(validateQuery(undefined).ok, false);
  assert.equal(validateQuery(' ').ok, false);
  assert.equal(validateQuery('<script>').ok, false);
  assert.equal(validateQuery('123').ok, false);
  assert.equal(validateQuery('++').ok, false);
  assert.equal(validateQuery('mp-invalid').ok, false);
  assert.equal(validateQuery('abc').ok, false);
  assert.equal(validateQuery('Si..').ok, false);
  assert.equal(validateQuery('A+').ok, false);
  assert.equal(validateQuery('Si'.repeat(51)).ok, false);
});

test('projects a summary document without exposing upstream fields', () => {
  const result = projectMaterial({
    material_id: 'mp-149',
    formula_pretty: 'Si',
    structure: null,
  });

  assert.deepEqual(result, {
    materialId: 'mp-149',
    formula: 'Si',
    properties: {},
    structure: null,
  });
});

test('builds a summary search URL for IDs and formulas with only required fields', () => {
  const expectedFields = [
    'material_id',
    'formula_pretty',
    'band_gap',
    'density',
    'volume',
    'energy_above_hull',
    'formation_energy_per_atom',
    'is_stable',
    'symmetry',
    'elements',
    'structure',
    'deprecated',
  ].join(',');

  const idUrl = new URL(buildSearchUrl('mp-149'));
  assert.equal(idUrl.origin, 'https://api.materialsproject.org');
  assert.equal(idUrl.pathname, '/materials/summary/');
  assert.equal(idUrl.searchParams.get('material_ids'), 'mp-149');
  assert.equal(idUrl.searchParams.has('formula'), false);
  assert.equal(idUrl.searchParams.get('_fields'), expectedFields);
  assert.equal(idUrl.searchParams.get('_limit'), '10');

  const formulaUrl = new URL(buildSearchUrl('LiFePO4'));
  assert.equal(formulaUrl.searchParams.get('formula'), 'LiFePO4');
  assert.equal(formulaUrl.searchParams.has('material_ids'), false);
  assert.equal(formulaUrl.searchParams.get('_fields'), expectedFields);
  assert.equal(formulaUrl.searchParams.get('_limit'), '10');
});

test('projects documented properties and browser-safe structure data', () => {
  const result = projectMaterial({
    material_id: 'mp-149',
    formula_pretty: 'Si',
    band_gap: 0,
    density: 2.33,
    volume: 40.05,
    energy_above_hull: 0,
    formation_energy_per_atom: -0.54,
    is_stable: false,
    symmetry: {
      crystal_system: 'Cubic',
      symbol: 'Fd-3m',
      number: 227,
      upstreamDetail: 'private',
    },
    elements: ['Si'],
    structure: {
      lattice: {
        matrix: [[0, 2.7, 2.7], [2.7, 0, 2.7], [2.7, 2.7, 0]],
        volume: 40.05,
      },
      sites: [{
        species: [{ element: 'Si', occu: 1 }],
        abc: [0, 0, 0],
        xyz: [0, 0, 0],
      }],
      upstreamDetail: 'private',
    },
    upstreamSecret: 'never expose this',
  });

  assert.deepEqual(result, {
    materialId: 'mp-149',
    formula: 'Si',
    properties: {
      bandGapEv: 0,
      densityGcm3: 2.33,
      volumeA3: 40.05,
      energyAboveHullEvAtom: 0,
      formationEnergyEvAtom: -0.54,
      isStable: false,
      crystalSystem: 'Cubic',
      spaceGroup: 'Fd-3m',
      spaceGroupNumber: 227,
      elements: ['Si'],
    },
    structure: {
      lattice: [[0, 2.7, 2.7], [2.7, 0, 2.7], [2.7, 2.7, 0]],
      sites: [{ element: 'Si', fractional: [0, 0, 0] }],
    },
  });
});

test('returns a null structure when a required structure component is unavailable', () => {
  assert.equal(projectMaterial({
    material_id: 'mp-149',
    formula_pretty: 'Si',
    structure: {
      lattice: { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
      sites: [{ species: [{ element: 'Si' }] }],
    },
  }).structure, null);
});

test('returns at most ten non-deprecated projected records', () => {
  const docs = Array.from({ length: 12 }, (_, index) => ({
    material_id: `mp-${index}`,
    formula_pretty: `X${index}`,
    deprecated: index === 0,
    structure: null,
  }));

  const results = projectResults(docs);

  assert.equal(results.length, 10);
  assert.deepEqual(results.map(({ materialId }) => materialId), [
    'mp-1', 'mp-2', 'mp-3', 'mp-4', 'mp-5',
    'mp-6', 'mp-7', 'mp-8', 'mp-9', 'mp-10',
  ]);
});

test('rejects non-GET requests and advertises the allowed method', async () => {
  const response = await invoke({ method: 'POST', query: { q: 'Si' } });

  assert.equal(response.statusCode, 405);
  assert.equal(response.headers.allow, 'GET');
  assert.deepEqual(response.body, { error: 'Method not allowed.' });
});

test('rejects invalid queries before calling upstream', async () => {
  process.env.MP_API_KEY = 'private-key';
  globalThis.fetch = async () => {
    throw new Error('fetch should not be called');
  };

  for (const query of ['<script>', 'abc', 'Si..', 'A+']) {
    const response = await invoke({ method: 'GET', query: { q: query } });
    assert.equal(response.statusCode, 400, query);
    assert.deepEqual(response.body, {
      error: 'Enter a valid formula or Materials Project ID.',
    });
  }
});

test('requires the private API key without exposing configuration details', async () => {
  delete process.env.MP_API_KEY;

  const response = await invoke({ method: 'GET', query: { q: 'Si' } });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, { error: 'Materials search is not configured.' });
});

test('calls upstream privately and returns projected results with cache headers', async () => {
  process.env.MP_API_KEY = 'private-key';
  let requestedUrl;
  let requestedOptions;
  let timeoutDelay;
  let clearedTimeout;
  const timeoutHandle = Symbol('timeout');
  globalThis.setTimeout = (_callback, delay) => {
    timeoutDelay = delay;
    return timeoutHandle;
  };
  globalThis.clearTimeout = (handle) => {
    clearedTimeout = handle;
  };
  globalThis.fetch = async (url, options) => {
    requestedUrl = url;
    requestedOptions = options;
    return new Response(JSON.stringify({
      data: [{
        material_id: 'mp-149',
        formula_pretty: 'Si',
        band_gap: 0.62,
        deprecated: false,
        structure: null,
        privateUpstreamField: 'do not expose',
      }],
    }), { status: 200 });
  };

  const response = await invoke({ method: 'GET', query: { q: ' mp-149 ' } });

  const url = new URL(requestedUrl);
  assert.equal(url.searchParams.get('material_ids'), 'mp-149');
  assert.equal(requestedOptions.headers['X-API-KEY'], 'private-key');
  assert.ok(requestedOptions.signal instanceof AbortSignal);
  assert.equal(timeoutDelay, 10_000);
  assert.equal(clearedTimeout, timeoutHandle);
  assert.equal(requestedUrl.includes('private-key'), false);
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(response.headers['cache-control'], 'public, max-age=300, s-maxage=3600');
  assert.deepEqual(response.body, {
    results: [{
      materialId: 'mp-149',
      formula: 'Si',
      properties: { bandGapEv: 0.62 },
      structure: null,
    }],
  });
  assert.equal(JSON.stringify(response.body).includes('private-key'), false);
});

test('keeps the upstream timeout active until response JSON parsing completes', async () => {
  process.env.MP_API_KEY = 'private-key';
  let timeoutCleared = false;
  const timeoutHandle = Symbol('timeout');
  globalThis.setTimeout = () => timeoutHandle;
  globalThis.clearTimeout = (handle) => {
    assert.equal(handle, timeoutHandle);
    timeoutCleared = true;
  };
  globalThis.fetch = async () => ({
    ok: true,
    async json() {
      assert.equal(timeoutCleared, false);
      return {
        data: [{
          material_id: 'mp-149',
          formula_pretty: 'Si',
          structure: null,
        }],
      };
    },
  });

  const response = await invoke({ method: 'GET', query: { q: 'Si' } });

  assert.equal(response.statusCode, 200);
  assert.equal(timeoutCleared, true);
});

test('maps a timeout during upstream JSON parsing to a user-safe 503', async () => {
  process.env.MP_API_KEY = 'private-key';
  let abortOnTimeout;
  globalThis.setTimeout = (callback) => {
    abortOnTimeout = callback;
    return Symbol('timeout');
  };
  globalThis.clearTimeout = () => {};
  globalThis.fetch = async (_url, { signal }) => ({
    ok: true,
    async json() {
      abortOnTimeout();
      assert.equal(signal.aborted, true);
      throw new DOMException('The operation was aborted.', 'AbortError');
    },
  });

  const response = await invoke({ method: 'GET', query: { q: 'Si' } });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    error: 'Materials Project is temporarily unavailable.',
  });
});

test('maps an empty result set to 404', async () => {
  process.env.MP_API_KEY = 'private-key';
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [] }), { status: 200 });

  const response = await invoke({ method: 'GET', query: { q: 'Si' } });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'No materials found.' });
});

test('maps upstream request and timeout failures to a user-safe 503', async () => {
  process.env.MP_API_KEY = 'private-key';
  globalThis.fetch = async () => {
    throw new Error('upstream secret response body');
  };

  const response = await invoke({ method: 'GET', query: { q: 'Si' } });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    error: 'Materials Project is temporarily unavailable.',
  });
  assert.doesNotMatch(JSON.stringify(response.body), /upstream secret/);
});

test('maps a non-success upstream status to a user-safe 503', async () => {
  process.env.MP_API_KEY = 'private-key';
  globalThis.fetch = async () => new Response('private upstream failure', { status: 429 });

  const response = await invoke({ method: 'GET', query: { q: 'Si' } });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.body, {
    error: 'Materials Project is temporarily unavailable.',
  });
});

test('maps invalid JSON and unusable payloads to a user-safe 502', async (t) => {
  await t.test('invalid JSON', async () => {
    process.env.MP_API_KEY = 'private-key';
    globalThis.fetch = async () => new Response('not json', { status: 200 });
    const response = await invoke({ method: 'GET', query: { q: 'Si' } });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, {
      error: 'Materials Project returned an unusable response.',
    });
  });

  await t.test('missing data array', async () => {
    process.env.MP_API_KEY = 'private-key';
    globalThis.fetch = async () => new Response(JSON.stringify({ data: {} }), { status: 200 });
    const response = await invoke({ method: 'GET', query: { q: 'Si' } });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, {
      error: 'Materials Project returned an unusable response.',
    });
  });

  await t.test('material missing required identity fields', async () => {
    process.env.MP_API_KEY = 'private-key';
    globalThis.fetch = async () => new Response(JSON.stringify({
      data: [{ material_id: 'mp-149', structure: null }],
    }), { status: 200 });
    const response = await invoke({ method: 'GET', query: { q: 'Si' } });
    assert.equal(response.statusCode, 502);
    assert.deepEqual(response.body, {
      error: 'Materials Project returned an unusable response.',
    });
  });
});
