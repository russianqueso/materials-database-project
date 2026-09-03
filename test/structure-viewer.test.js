import test from 'node:test';
import assert from 'node:assert/strict';
import * as structureViewer from '../public/structure-viewer.js';

const {
  colorForElement,
  fractionalToCartesian,
  renderStructure,
  unitCellEdges,
} = structureViewer;

const VALID_STRUCTURE = {
  lattice: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  sites: [{ element: 'Si', fractional: [0, 0, 0] }],
};

const DEGENERATE_STRUCTURE = {
  lattice: [[1, 0, 0], [2, 0, 0], [0, 0, 1]],
  sites: [{ element: 'Si', fractional: [0, 0, 0] }],
};

class FakeElement {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument;
    this.attributes = new Map();
    this.children = [];
  }

  get textContent() {
    return this.children.map((child) => child.textContent).join('');
  }

  append(...children) {
    this.children.push(...children);
  }

  replaceChildren(...children) {
    this.children = children;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }
}

function createViewerContainer() {
  const document = {
    createElement() {
      return new FakeElement(this);
    },
    createTextNode(textContent) {
      return { textContent };
    },
  };
  const container = new FakeElement(document);
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', 'Three-dimensional crystal structure preview');
  return container;
}

test('converts fractional coordinates with lattice row vectors', () => {
  assert.deepEqual(
    fractionalToCartesian(
      [0.5, 0.5, 0.5],
      [[2, 0, 0], [0, 4, 0], [0, 0, 6]],
    ),
    [1, 2, 3],
  );
});

test('returns the twelve unit-cell edges', () => {
  assert.equal(
    unitCellEdges([[1, 0, 0], [0, 1, 0], [0, 0, 1]]).length,
    12,
  );
});

test('uses one neutral numeric color for unknown elements', () => {
  const firstUnknown = colorForElement('Xx');

  assert.equal(typeof firstUnknown, 'number');
  assert.equal(colorForElement('Qq'), firstUnknown);
});

test('accepts a finite, nondegenerate structure with a site', () => {
  assert.equal(structureViewer.isValidStructure(VALID_STRUCTURE), true);
});

test('rejects a structure without sites', () => {
  assert.equal(structureViewer.isValidStructure({
    ...VALID_STRUCTURE,
    sites: [],
  }), false);
});

test('rejects a zero-volume lattice basis', () => {
  assert.equal(structureViewer.isValidStructure(DEGENERATE_STRUCTURE), false);
});

test('invalid structures bypass browser imports and show the no-structure fallback', async () => {
  const container = createViewerContainer();

  await renderStructure(container, DEGENERATE_STRUCTURE);

  assert.equal(
    container.textContent,
    'No crystal structure is available for this material.',
  );
});

test('fallback content remains exposed as a live status inside a labeled region', async () => {
  const container = createViewerContainer();

  await renderStructure(container, null);

  assert.equal(container.getAttribute('role'), 'region');
  assert.equal(container.getAttribute('aria-label'), 'Crystal structure preview');
  assert.equal(container.children[0].getAttribute('role'), 'status');
});

test('loading and module-failure fallbacks retain accessible status semantics', async () => {
  const container = createViewerContainer();

  const rendering = renderStructure(container, VALID_STRUCTURE);
  assert.equal(container.textContent, 'Loading interactive crystal structure…');
  assert.equal(container.getAttribute('role'), 'region');
  assert.equal(container.children[0].getAttribute('role'), 'status');

  await rendering;
  assert.equal(
    container.textContent,
    'The interactive structure preview could not be loaded.',
  );
  assert.equal(container.children[0].getAttribute('role'), 'status');
});
