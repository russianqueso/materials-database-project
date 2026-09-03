const MATERIAL_ID_PATTERN = /^mp-\d+$/;
const ELEMENT_SYMBOLS = new Set([
  'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr', 'Rb', 'Sr', 'Y', 'Zr',
  'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn',
  'Sb', 'Te', 'I', 'Xe', 'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd',
  'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb',
  'Lu', 'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg',
  'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn', 'Fr', 'Ra', 'Ac', 'Th',
  'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm',
  'Md', 'No', 'Lr', 'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds',
  'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
]);
const MATERIALS_ENDPOINT = 'https://api.materialsproject.org/materials/summary/';
const MATERIAL_FIELDS = [
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
];

const PROPERTY_FIELDS = [
  ['band_gap', 'bandGapEv'],
  ['density', 'densityGcm3'],
  ['volume', 'volumeA3'],
  ['energy_above_hull', 'energyAboveHullEvAtom'],
  ['formation_energy_per_atom', 'formationEnergyEvAtom'],
  ['is_stable', 'isStable'],
];

const SYMMETRY_FIELDS = [
  ['crystal_system', 'crystalSystem'],
  ['symbol', 'spaceGroup'],
  ['number', 'spaceGroupNumber'],
];

function hasOwn(object, key) {
  return object != null && Object.hasOwn(object, key);
}

function isCoordinate(vector) {
  return Array.isArray(vector)
    && vector.length === 3
    && vector.every(Number.isFinite);
}

function projectStructure(structure) {
  const matrix = structure?.lattice?.matrix;
  const sites = structure?.sites;
  if (
    !Array.isArray(matrix)
    || matrix.length !== 3
    || !matrix.every(isCoordinate)
    || !Array.isArray(sites)
    || sites.length === 0
  ) {
    return null;
  }

  const projectedSites = [];
  for (const site of sites) {
    const element = site?.species?.[0]?.element;
    if (typeof element !== 'string' || element.length === 0 || !isCoordinate(site?.abc)) {
      return null;
    }
    projectedSites.push({ element, fractional: [...site.abc] });
  }

  return {
    lattice: matrix.map((vector) => [...vector]),
    sites: projectedSites,
  };
}

function isValidFormula(value) {
  let index = 0;

  function consumeNumber() {
    const match = value.slice(index).match(/^\d+(?:\.\d+)?/);
    if (match) {
      index += match[0].length;
    }
  }

  function consumeSequence(inParentheses) {
    let termCount = 0;

    while (index < value.length) {
      if (value[index] === ')') {
        if (!inParentheses || termCount === 0) {
          return false;
        }
        index += 1;
        consumeNumber();
        return true;
      }

      if (value[index] === '(') {
        index += 1;
        if (!consumeSequence(true)) {
          return false;
        }
        termCount += 1;
        continue;
      }

      const elementMatch = value.slice(index).match(/^[A-Z][a-z]?/);
      if (!elementMatch || !ELEMENT_SYMBOLS.has(elementMatch[0])) {
        break;
      }
      index += elementMatch[0].length;
      consumeNumber();
      termCount += 1;
    }

    return !inParentheses && termCount > 0;
  }

  if (!consumeSequence(false)) {
    return false;
  }
  return index === value.length
    || (index === value.length - 1 && (value[index] === '+' || value[index] === '-'));
}

export function validateQuery(query) {
  if (typeof query !== 'string') {
    return { ok: false };
  }

  const value = query.trim();
  const isMaterialId = MATERIAL_ID_PATTERN.test(value);
  const isFormula = !value.toLowerCase().startsWith('mp-') && isValidFormula(value);
  if (
    value.length === 0
    || value.length > 100
    || (!isMaterialId && !isFormula)
  ) {
    return { ok: false };
  }

  return { ok: true, value };
}

export function buildSearchUrl(query) {
  const url = new URL(MATERIALS_ENDPOINT);
  const search = new URLSearchParams();
  search.set(MATERIAL_ID_PATTERN.test(query) ? 'material_ids' : 'formula', query);
  search.set('_fields', MATERIAL_FIELDS.join(','));
  url.search = search;
  return url.toString();
}

export function projectMaterial(doc) {
  const properties = {};
  for (const [source, target] of PROPERTY_FIELDS) {
    if (hasOwn(doc, source)) {
      properties[target] = doc[source];
    }
  }

  for (const [source, target] of SYMMETRY_FIELDS) {
    if (hasOwn(doc?.symmetry, source)) {
      properties[target] = doc.symmetry[source];
    }
  }

  if (Array.isArray(doc?.elements)) {
    properties.elements = doc.elements.filter((element) => typeof element === 'string');
  }

  return {
    materialId: doc.material_id,
    formula: doc.formula_pretty,
    properties,
    structure: projectStructure(doc.structure),
  };
}

export function projectResults(docs) {
  return docs
    .filter((doc) => doc?.deprecated !== true)
    .slice(0, 10)
    .map(projectMaterial);
}
