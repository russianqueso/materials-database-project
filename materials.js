import {
  buildSearchUrl,
  projectResults,
  validateQuery,
} from '../lib/materials.js';

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
const SUCCESS_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600';
const UPSTREAM_TIMEOUT_MS = 10_000;

function sendJson(response, statusCode, body) {
  response.setHeader('Content-Type', JSON_CONTENT_TYPE);
  return response.status(statusCode).json(body);
}

function isUsableMaterial(material) {
  return typeof material?.materialId === 'string'
    && typeof material?.formula === 'string';
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    sendJson(response, 405, { error: 'Method not allowed.' });
    return;
  }

  const validation = validateQuery(request.query?.q);
  if (!validation.ok) {
    sendJson(response, 400, {
      error: 'Enter a valid formula or Materials Project ID.',
    });
    return;
  }

  const apiKey = process.env.MP_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    sendJson(response, 503, { error: 'Materials search is not configured.' });
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let upstreamResponse;
  let payload;
  try {
    try {
      upstreamResponse = await fetch(buildSearchUrl(validation.value), {
        headers: { 'X-API-KEY': apiKey },
        signal: controller.signal,
      });
    } catch {
      sendJson(response, 503, {
        error: 'Materials Project is temporarily unavailable.',
      });
      return;
    }

    if (!upstreamResponse.ok) {
      sendJson(response, 503, {
        error: 'Materials Project is temporarily unavailable.',
      });
      return;
    }

    try {
      payload = await upstreamResponse.json();
    } catch {
      if (controller.signal.aborted) {
        sendJson(response, 503, {
          error: 'Materials Project is temporarily unavailable.',
        });
      } else {
        sendJson(response, 502, {
          error: 'Materials Project returned an unusable response.',
        });
      }
      return;
    }
  } finally {
    clearTimeout(timeout);
  }

  let results;
  try {
    if (!Array.isArray(payload?.data)) {
      throw new TypeError('Expected a data array');
    }
    results = projectResults(payload.data);
    if (!results.every(isUsableMaterial)) {
      throw new TypeError('Expected material identifiers and formulas');
    }
  } catch {
    sendJson(response, 502, {
      error: 'Materials Project returned an unusable response.',
    });
    return;
  }

  if (results.length === 0) {
    sendJson(response, 404, { error: 'No materials found.' });
    return;
  }

  response.setHeader('Cache-Control', SUCCESS_CACHE_CONTROL);
  sendJson(response, 200, { results });
}
