import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatValue,
  initializeApp,
  searchMaterials,
} from '../public/app.js';

class FakeNode {
  constructor(ownerDocument, tagName = '') {
    this.ownerDocument = ownerDocument;
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.dataset = {};
    this.hidden = false;
    this.disabled = false;
    this.value = '';
    this.listeners = new Map();
  }

  get textContent() {
    return this.children.map((child) => child.textContent).join('');
  }

  set textContent(value) {
    this.replaceChildren(this.ownerDocument.createTextNode(String(value)));
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = [...children];
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type) {
    return Promise.all((this.listeners.get(type) ?? []).map((listener) => listener({
      preventDefault() {},
      currentTarget: this,
    })));
  }
}

function createUiHarness() {
  const popularButtons = ['Si', 'LiFePO4', 'TiO2', 'mp-149'].map((query) => {
    const button = new FakeNode(null, 'button');
    button.dataset.query = query;
    return button;
  });
  const document = {
    elements: new Map(),
    popularButtons,
    createElement(tagName) {
      return new FakeNode(this, tagName);
    },
    createTextNode(value) {
      return { textContent: String(value) };
    },
    getElementById(id) {
      return this.elements.get(id) ?? null;
    },
    querySelectorAll(selector) {
      return selector === '[data-query]' ? this.popularButtons : [];
    },
  };
  for (const button of popularButtons) {
    button.ownerDocument = document;
  }

  for (const id of [
    'search-form',
    'material-query',
    'search-submit',
    'random-material',
    'search-status',
    'results-panel',
    'result-select-wrap',
    'result-select',
    'material-details',
    'viewer',
  ]) {
    document.elements.set(id, new FakeNode(document));
  }
  document.getElementById('results-panel').hidden = true;
  document.getElementById('result-select-wrap').hidden = true;
  const form = document.getElementById('search-form');
  form.requestSubmit = () => {
    form.lastSubmission = form.dispatch('submit');
    return form.lastSubmission;
  };
  return document;
}

test('formats missing values as an em dash', () => {
  assert.equal(formatValue(null), '—');
});

test('formats numbers with Intl grouping and requested precision', () => {
  assert.equal(formatValue(1234.5, { digits: 2, unit: 'eV' }), '1,234.50 eV');
});

test('search calls the same-origin API with an encoded query', async () => {
  let requestedUrl;
  await searchMaterials('Fe2+', async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ results: [] }) };
  });
  assert.equal(requestedUrl, '/api/materials?q=Fe2%2B');
});

test('random material chooses a popular query and initiates a search', async () => {
  const root = createUiHarness();
  let requestedUrl;
  initializeApp(root, async (url) => {
    requestedUrl = url;
    return { ok: true, json: async () => ({ results: [] }) };
  }, () => 0.5);

  await root.getElementById('random-material').dispatch('click');
  await root.getElementById('search-form').lastSubmission;

  assert.equal(root.getElementById('material-query').value, 'TiO2');
  assert.equal(requestedUrl, '/api/materials?q=TiO2');
});

test('submission announces loading and disables the submit control until settled', async () => {
  const root = createUiHarness();
  let finishRequest;
  const pendingResponse = new Promise((resolve) => {
    finishRequest = resolve;
  });
  initializeApp(root, async () => pendingResponse);
  root.getElementById('material-query').value = 'Si';

  const submission = root.getElementById('search-form').dispatch('submit');

  assert.equal(root.getElementById('search-submit').disabled, true);
  assert.equal(root.getElementById('search-status').textContent, 'Searching materials…');
  finishRequest({ ok: true, json: async () => ({ results: [] }) });
  await submission;
  assert.equal(root.getElementById('search-submit').disabled, false);
});

test('all search initiators are locked during a request and restored afterward', async () => {
  const root = createUiHarness();
  let finishRequest;
  let requestCount = 0;
  const pendingResponse = new Promise((resolve) => {
    finishRequest = resolve;
  });
  initializeApp(root, async () => {
    requestCount += 1;
    return pendingResponse;
  });
  root.getElementById('material-query').value = 'Si';

  const submission = root.getElementById('search-form').dispatch('submit');
  await root.popularButtons[1].dispatch('click');
  await root.getElementById('random-material').dispatch('click');

  const initiators = [
    root.getElementById('search-submit'),
    root.getElementById('random-material'),
    ...root.popularButtons,
  ];
  assert.equal(initiators.every(({ disabled }) => disabled), true);
  assert.equal(requestCount, 1);

  finishRequest({
    ok: false,
    json: async () => ({ error: 'Materials Project is temporarily unavailable.' }),
  });
  await submission;
  assert.equal(initiators.every(({ disabled }) => !disabled), true);
});

test('an empty API result keeps the result panel hidden', async () => {
  const root = createUiHarness();
  initializeApp(root, async () => ({
    ok: true,
    json: async () => ({ results: [] }),
  }));
  root.getElementById('material-query').value = 'Si';

  await root.getElementById('search-form').dispatch('submit');

  assert.equal(root.getElementById('search-status').textContent, 'No materials found.');
  assert.equal(root.getElementById('results-panel').hidden, true);
});

test('a server error is mapped to its user-safe visible message', async () => {
  const root = createUiHarness();
  initializeApp(root, async () => ({
    ok: false,
    json: async () => ({ error: 'Materials Project is temporarily unavailable.' }),
  }));
  root.getElementById('material-query').value = 'Si';

  await root.getElementById('search-form').dispatch('submit');

  assert.equal(
    root.getElementById('search-status').textContent,
    'Materials Project is temporarily unavailable.',
  );
  assert.equal(root.getElementById('search-status').dataset.kind, 'error');
});
