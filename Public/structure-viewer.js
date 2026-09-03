const THREE_VERSION = '0.180.0';
const THREE_MODULE_URL = `https://esm.sh/three@${THREE_VERSION}/build/three.module.js`;
const ORBIT_CONTROLS_URL = `https://esm.sh/three@${THREE_VERSION}/examples/jsm/controls/OrbitControls.js`;

const ELEMENT_COLORS = {
  C: 0x4b5563,
  H: 0xf8fafc,
  N: 0x2563eb,
  O: 0xdc2626,
  F: 0x16a34a,
  P: 0xf97316,
  S: 0xeab308,
  Si: 0xd97706,
  Cl: 0x22c55e,
  Fe: 0xb45309,
  Li: 0xa855f7,
  Na: 0x7c3aed,
  Ti: 0x94a3b8,
};

let activeViewer = null;
let renderToken = 0;

export function fractionalToCartesian(fractional, lattice) {
  return [0, 1, 2].map((component) => (
    fractional[0] * lattice[0][component]
    + fractional[1] * lattice[1][component]
    + fractional[2] * lattice[2][component]
  ));
}

export function unitCellEdges(lattice) {
  const corners = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [1, 1, 0],
    [0, 0, 1],
    [1, 0, 1],
    [0, 1, 1],
    [1, 1, 1],
  ].map((corner) => fractionalToCartesian(corner, lattice));
  const cornerPairs = [
    [0, 1], [0, 2], [0, 4],
    [1, 3], [1, 5],
    [2, 3], [2, 6],
    [3, 7],
    [4, 5], [4, 6],
    [5, 7],
    [6, 7],
  ];

  return cornerPairs.map(([start, end]) => [corners[start], corners[end]]);
}

function isVector3(value) {
  return Array.isArray(value)
    && value.length === 3
    && value.every(Number.isFinite);
}

function latticeHasVolume(lattice) {
  const [a, b, c] = lattice;
  const determinant = (
    a[0] * (b[1] * c[2] - b[2] * c[1])
    - a[1] * (b[0] * c[2] - b[2] * c[0])
    + a[2] * (b[0] * c[1] - b[1] * c[0])
  );
  const lengthProduct = Math.hypot(...a) * Math.hypot(...b) * Math.hypot(...c);
  return Math.abs(determinant) > Number.EPSILON * Math.max(1, lengthProduct);
}

export function isValidStructure(structure) {
  return Boolean(
    structure
    && Array.isArray(structure.lattice)
    && structure.lattice.length === 3
    && structure.lattice.every(isVector3)
    && latticeHasVolume(structure.lattice)
    && Array.isArray(structure.sites)
    && structure.sites.length > 0
    && structure.sites.every((site) => (
      site
      && typeof site.element === 'string'
      && site.element.trim().length > 0
      && isVector3(site.fractional)
    )),
  );
}

function showFallback(container, message) {
  const documentImpl = container.ownerDocument ?? document;
  container.setAttribute('role', 'region');
  container.setAttribute('aria-label', 'Crystal structure preview');
  const fallback = documentImpl.createElement('p');
  fallback.className = 'structure-viewer-message';
  fallback.setAttribute('role', 'status');
  fallback.append(documentImpl.createTextNode(message));
  container.replaceChildren(fallback);
}

function disposeMaterial(material) {
  for (const value of Object.values(material)) {
    if (value?.isTexture) {
      value.dispose();
    }
  }
  material.dispose();
}

function teardownViewer(viewer, clearContainer = true) {
  if (!viewer) {
    return;
  }

  const {
    container,
    controls,
    geometries = new Set(),
    materials = new Set(),
    renderer,
    resizeObserver,
    resizeHandler,
    renderHandler,
    scene,
  } = viewer;
  resizeObserver?.disconnect();
  if (resizeHandler) {
    globalThis.removeEventListener?.('resize', resizeHandler);
  }
  if (controls && renderHandler) {
    controls.removeEventListener('change', renderHandler);
  }
  controls?.dispose();

  scene?.traverse((object) => {
    if (object.geometry) {
      geometries.add(object.geometry);
    }
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of objectMaterials) {
      if (material) {
        materials.add(material);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach(disposeMaterial);
  renderer?.renderLists?.dispose();
  renderer?.dispose();
  renderer?.forceContextLoss?.();
  renderer?.domElement?.remove();
  if (clearContainer) {
    container.replaceChildren();
  }
  if (activeViewer === viewer) {
    activeViewer = null;
  }
}

function teardownActiveViewer() {
  const viewer = activeViewer;
  activeViewer = null;
  teardownViewer(viewer);
}

export function disposeStructureViewer() {
  renderToken += 1;
  teardownActiveViewer();
}

function colorForElement(element) {
  if (ELEMENT_COLORS[element]) {
    return ELEMENT_COLORS[element];
  }
  let hash = 0;
  for (const character of element) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }
  return `hsl(${Math.abs(hash) % 360} 58% 58%)`;
}

export async function renderStructure(container, structure) {
  disposeStructureViewer();
  const currentToken = renderToken;
  const pendingViewer = {
    container,
    geometries: new Set(),
    materials: new Set(),
  };

  if (!isValidStructure(structure)) {
    showFallback(container, 'No crystal structure is available for this material.');
    return;
  }

  showFallback(container, 'Loading interactive crystal structure…');

  try {
    const [THREE, { OrbitControls }] = await Promise.all([
      import(THREE_MODULE_URL),
      import(ORBIT_CONTROLS_URL),
    ]);
    if (currentToken !== renderToken) {
      return;
    }

    const cartesianSites = structure.sites.map((site) => ({
      element: site.element,
      cartesian: fractionalToCartesian(site.fractional, structure.lattice),
    }));
    const edges = unitCellEdges(structure.lattice);
    const scene = new THREE.Scene();
    pendingViewer.scene = scene;
    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    pendingViewer.renderer = renderer;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.domElement.setAttribute('role', 'img');
    renderer.domElement.setAttribute(
      'aria-label',
      'Interactive three-dimensional crystal structure. Drag to rotate and scroll to zoom.',
    );
    container.replaceChildren(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x284035, 2.2));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
    keyLight.position.set(5, 8, 10);
    scene.add(keyLight);

    const cellPoints = edges.flat().map((point) => new THREE.Vector3(...point));
    const cellBounds = new THREE.Box3().setFromPoints(cellPoints);
    const cellSize = cellBounds.getSize(new THREE.Vector3());
    const maxLatticeDimension = Math.max(cellSize.x, cellSize.y, cellSize.z, 1);
    const atomGeometry = new THREE.SphereGeometry(maxLatticeDimension * 0.055, 24, 16);
    pendingViewer.geometries.add(atomGeometry);
    const atomMaterials = new Map();
    for (const site of cartesianSites) {
      let material = atomMaterials.get(site.element);
      if (!material) {
        material = new THREE.MeshStandardMaterial({
          color: colorForElement(site.element),
          metalness: 0.08,
          roughness: 0.38,
        });
        atomMaterials.set(site.element, material);
        pendingViewer.materials.add(material);
      }
      const atom = new THREE.Mesh(atomGeometry, material);
      atom.position.set(...site.cartesian);
      scene.add(atom);
    }

    const edgeGeometry = new THREE.BufferGeometry().setFromPoints(cellPoints);
    pendingViewer.geometries.add(edgeGeometry);
    const edgeMaterial = new THREE.LineBasicMaterial({
      color: 0xd7e2db,
      transparent: true,
      opacity: 0.85,
    });
    pendingViewer.materials.add(edgeMaterial);
    scene.add(new THREE.LineSegments(edgeGeometry, edgeMaterial));

    const center = cellBounds.getCenter(new THREE.Vector3());
    const boundingSphere = cellBounds.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(boundingSphere.radius, 1);
    const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
    camera.position.copy(center).add(new THREE.Vector3(1, 0.8, 1).normalize().multiplyScalar(distance * 1.15));
    camera.near = Math.max(distance / 1000, 0.01);
    camera.far = distance * 10;
    camera.updateProjectionMatrix();

    const controls = new OrbitControls(camera, renderer.domElement);
    pendingViewer.controls = controls;
    controls.target.copy(center);
    controls.enableDamping = false;
    controls.minDistance = radius * 0.3;
    controls.maxDistance = distance * 5;

    const resize = () => {
      const width = Math.max(container.clientWidth || 640, 1);
      const height = Math.max(container.clientHeight || 400, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    };
    pendingViewer.renderHandler = resize;
    controls.addEventListener('change', resize);
    controls.update();

    let resizeObserver;
    let resizeHandler;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(resize);
      pendingViewer.resizeObserver = resizeObserver;
      resizeObserver.observe(container);
    } else {
      resizeHandler = resize;
      pendingViewer.resizeHandler = resizeHandler;
      globalThis.addEventListener?.('resize', resizeHandler);
    }
    activeViewer = pendingViewer;
    resize();
  } catch {
    teardownViewer(pendingViewer, currentToken === renderToken);
    if (currentToken === renderToken) {
      showFallback(container, 'The interactive structure preview could not be loaded.');
    }
  }
}
