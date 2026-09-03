import {
  disposeStructureViewer,
  renderStructure,
} from './structure-viewer.js';

export function formatValue(value, options = {}) {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  const { unit = '', digits } = options;
  let formatted;
  if (Array.isArray(value)) {
    formatted = value.length > 0 ? value.join(', ') : '—';
  } else if (typeof value === 'boolean') {
    formatted = value ? 'Yes' : 'No';
  } else {
    formatted = typeof value === 'number' && Number.isInteger(digits)
      ? new Intl.NumberFormat('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(value)
      : String(value);
  }

  return unit && formatted !== '—' ? `${formatted} ${unit}` : formatted;
}

export async function searchMaterials(query, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(`/api/materials?q=${encodeURIComponent(query)}`);
  } catch {
    throw new Error('Materials search is temporarily unavailable.');
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error('Materials search returned an unusable response.');
  }

  if (!response.ok) {
    const message = typeof payload?.error === 'string' && payload.error.length > 0
      ? payload.error
      : 'Materials search is temporarily unavailable.';
    throw new Error(message);
  }

  if (!Array.isArray(payload?.results)) {
    throw new Error('Materials search returned an unusable response.');
  }

  return payload.results;
}

function appendText(element, value, documentImpl) {
  element.append(documentImpl.createTextNode(String(value)));
}

function makeProperty(documentImpl, label, value) {
  const item = documentImpl.createElement('div');
  item.className = 'property';

  const term = documentImpl.createElement('dt');
  appendText(term, label, documentImpl);

  const description = documentImpl.createElement('dd');
  appendText(description, value, documentImpl);

  item.append(term, description);
  return item;
}

export function renderMaterial(result, documentImpl = document) {
  const properties = result?.properties ?? {};
  const card = documentImpl.createElement('article');
  card.className = 'material-card';

  const heading = documentImpl.createElement('h2');
  heading.className = 'material-formula';
  appendText(heading, formatValue(result?.formula), documentImpl);

  const identifier = documentImpl.createElement('p');
  identifier.className = 'material-id';
  appendText(identifier, formatValue(result?.materialId), documentImpl);

  const grid = documentImpl.createElement('dl');
  grid.className = 'property-grid';
  const rows = [
    ['Band gap', formatValue(properties.bandGapEv, { digits: 3, unit: 'eV' })],
    ['Density', formatValue(properties.densityGcm3, { digits: 3, unit: 'g/cm³' })],
    ['Volume', formatValue(properties.volumeA3, { digits: 2, unit: 'Å³' })],
    ['Energy above hull', formatValue(properties.energyAboveHullEvAtom, { digits: 4, unit: 'eV/atom' })],
    ['Formation energy', formatValue(properties.formationEnergyEvAtom, { digits: 4, unit: 'eV/atom' })],
    ['Stable', formatValue(properties.isStable)],
    ['Crystal system', formatValue(properties.crystalSystem)],
    ['Space group', formatValue(properties.spaceGroup)],
    ['Space-group number', formatValue(properties.spaceGroupNumber)],
    ['Elements', formatValue(properties.elements)],
  ];
  for (const [label, value] of rows) {
    grid.append(makeProperty(documentImpl, label, value));
  }

  card.append(heading, identifier, grid);
  return card;
}

export function setStatus(message, kind = 'info', root = document) {
  const status = root.getElementById('search-status');
  if (!status) {
    return;
  }
  status.replaceChildren(root.createTextNode(message));
  status.dataset.kind = kind;
}

function requiredElement(root, id) {
  const element = root.getElementById(id);
  if (!element) {
    throw new Error(`Missing required page element: ${id}`);
  }
  return element;
}

export function initializeApp(
  root = document,
  fetchImpl = globalThis.fetch,
  randomImpl = Math.random,
) {
  const form = requiredElement(root, 'search-form');
  const queryInput = requiredElement(root, 'material-query');
  const submitButton = requiredElement(root, 'search-submit');
  const randomButton = requiredElement(root, 'random-material');
  const resultsPanel = requiredElement(root, 'results-panel');
  const selectWrap = requiredElement(root, 'result-select-wrap');
  const resultSelect = requiredElement(root, 'result-select');
  const details = requiredElement(root, 'material-details');
  const viewer = requiredElement(root, 'viewer');
  const shortcutButtons = [...root.querySelectorAll('[data-query]')];
  const searchInitiators = [submitButton, randomButton, ...shortcutButtons];
  let currentResults = [];
  let isLoading = false;

  function setSearchDisabled(disabled) {
    for (const initiator of searchInitiators) {
      initiator.disabled = disabled;
    }
  }

  function clearResults() {
    disposeStructureViewer();
    currentResults = [];
    resultsPanel.hidden = true;
    selectWrap.hidden = true;
    resultSelect.replaceChildren();
    details.replaceChildren();
    viewer.replaceChildren();
  }

  function showResult(index) {
    const result = currentResults[index];
    if (!result) {
      return;
    }
    disposeStructureViewer();
    details.replaceChildren(renderMaterial(result, root));
    viewer.replaceChildren();
    void renderStructure(viewer, result.structure);
  }

  async function submitSearch(event) {
    event?.preventDefault();
    if (isLoading) {
      return;
    }
    const query = queryInput.value.trim();
    if (!query) {
      clearResults();
      setStatus('Enter a formula or Materials Project ID.', 'error', root);
      return;
    }

    clearResults();
    isLoading = true;
    setSearchDisabled(true);
    setStatus('Searching materials…', 'loading', root);

    try {
      currentResults = await searchMaterials(query, fetchImpl);
      if (currentResults.length === 0) {
        setStatus('No materials found.', 'empty', root);
        return;
      }

      for (const [index, result] of currentResults.entries()) {
        const option = root.createElement('option');
        option.value = String(index);
        appendText(
          option,
          `${formatValue(result.formula)} · ${formatValue(result.materialId)}`,
          root,
        );
        resultSelect.append(option);
      }
      selectWrap.hidden = currentResults.length < 2;
      resultsPanel.hidden = false;
      showResult(0);
      setStatus(
        currentResults.length === 1
          ? 'Found 1 material.'
          : `Found ${currentResults.length} materials.`,
        'success',
        root,
      );
    } catch (error) {
      const message = error instanceof Error
        ? error.message
        : 'Materials search is temporarily unavailable.';
      setStatus(message, 'error', root);
    } finally {
      isLoading = false;
      setSearchDisabled(false);
    }
  }

  form.addEventListener('submit', submitSearch);
  resultSelect.addEventListener('change', () => {
    showResult(Number.parseInt(resultSelect.value, 10));
  });
  for (const shortcut of shortcutButtons) {
    shortcut.addEventListener('click', () => {
      if (isLoading) {
        return;
      }
      queryInput.value = shortcut.dataset.query;
      return form.requestSubmit();
    });
  }
  randomButton.addEventListener('click', () => {
    if (isLoading || shortcutButtons.length === 0) {
      return;
    }
    const randomIndex = Math.min(
      shortcutButtons.length - 1,
      Math.floor(randomImpl() * shortcutButtons.length),
    );
    queryInput.value = shortcutButtons[randomIndex].dataset.query;
    return form.requestSubmit();
  });

  return { submitSearch };
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    initializeApp(document, globalThis.fetch.bind(globalThis));
  });
}
