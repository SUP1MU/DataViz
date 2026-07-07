/* global d3 */

export const db= {
  nodes: [],
  nodesMap: {},
  pairSummary: [],
  countrySummary: [],
  meta: null,
  edgesAll: null,
};

const BUCKETS= [
  { yearRange: [2016, 2025], voteType: 'total', round: 'final' },
  { yearRange: [2016, 2025], voteType: 'jury', round: 'final' },
  { yearRange: [2016, 2025], voteType: 'public', round: 'final' },
  { yearRange: [1957, 2025], voteType: 'total', round: 'final' },
];

export async function init() {
  const [nodes, pairSummary, countrySummary, meta, edgesAll]=
    await Promise.all([
      d3.json('data/nodes.json'),
      d3.json('data/pair_summary.json'),
      d3.json('data/country_summary.json'),
      d3.json('data/meta.json'),
      d3.json('data/edges_all.json'),
    ]);

  db.nodes= nodes;
  db.nodesMap= Object.fromEntries(nodes.map(n => [n.id, n]));
  db.pairSummary= pairSummary;
  db.countrySummary= countrySummary;
  db.meta= meta;
  db.edgesAll= edgesAll;
}

// cached accessors: both lookups depend only on yearrange, votetype, round
// unrelated state changes like search or selection dont trigger a rescan

let _pairsCache= null;
let _pairsCacheKey= '';
let _csCache= null;
let _csMapCache= null;
let _csCacheKey= '';

function _filterKey(state) {
  return `${state.yearRange[0]}|${state.yearRange[1]}|${state.voteType}|${state.round}`;
}

export function getFilteredPairs(state) {
  const key= _filterKey(state);
  if (key === _pairsCacheKey) return _pairsCache;
  _pairsCacheKey= key;

  const { yearRange, voteType, round }= state;
  if (_matchesBucket(state)) {
    _pairsCache= db.pairSummary.filter(p =>
      p.yearRange[0] === yearRange[0] &&
      p.yearRange[1] === yearRange[1] &&
      p.voteType === voteType &&
      p.round === round
    );
  } else {
    _pairsCache= _computeFromEdges(db.edgesAll, yearRange, voteType, round);
  }
  return _pairsCache;
}

export function getCountrySummary(state) {
  const key= _filterKey(state);
  if (key === _csCacheKey) return _csCache;
  _csCacheKey= key;
  _csCache= db.countrySummary.filter(c =>
    c.yearRange[0] === state.yearRange[0] &&
    c.yearRange[1] === state.yearRange[1] &&
    c.voteType === state.voteType &&
    c.round === state.round
  );
  _csMapCache= null;
  return _csCache;
}

export function getCountrySummaryMap(state) {
  const summary= getCountrySummary(state);
  if (!_csMapCache) _csMapCache= new Map(summary.map(s => [s.id, s]));
  return _csMapCache;
}

export function filterVisibleCodes(pairs, state) {
  let codes= [...new Set([...pairs.map(p => p.source), ...pairs.map(p => p.target)])];

  if (state.regionFilter) {
    const keep= new Set(
      db.nodes.filter(n => n.region === state.regionFilter).map(n => n.id)
    );
    codes= codes.filter(c => keep.has(c));
  }

  if (state.countrySearch?.trim()) {
    const q= state.countrySearch.trim().toLowerCase();
    codes= codes.filter(c => {
      const nd= db.nodesMap[c];
      return c.toLowerCase().includes(q) || (nd?.name || '').toLowerCase().includes(q);
    });
  }

  return codes;
}

export function getCountryStats(code, state) {
  const cs= getCountrySummaryMap(state).get(code);
  return {
    cs,
    recvPct: cs ? (cs.avg_points_received*100).toFixed(1)+'%' : 'n/a',
    givenPct: cs ? (cs.avg_points_given*100).toFixed(1)+'%' : 'n/a',
  };
}

function _matchesBucket(state) {
  return BUCKETS.some(b =>
    b.yearRange[0] === state.yearRange[0] &&
    b.yearRange[1] === state.yearRange[1] &&
    b.voteType === state.voteType &&
    b.round === state.round
  );
}

function _computeFromEdges(edges, yearRange, voteType, round) {
  if (!edges) return [];
  const [y0, y1]= yearRange;
  const filtered= edges.filter(e =>
    e.year >= y0 && e.year <= y1 &&
    e.voteType === voteType &&
    e.round === round
  );

  const pairMap= new Map();
  for (const e of filtered) {
    const key= `${e.source}::${e.target}`;
    if (!pairMap.has(key)) pairMap.set(key, []);
    pairMap.get(key).push(e);
  }

  const result= [];
  for (const [key, recs] of pairMap) {
    const [source, target]= key.split('::');
    const norms= recs.map(r => r.normalized);
    const pts= recs.map(r => r.points);
    const n= recs.length;
    const mean_normalized= norms.reduce((a, b) => a+b, 0)/n;
    const mean_points= pts.reduce((a, b) => a+b, 0)/n;
    const sorted= [...recs].sort((a, b) => a.year-b.year);
    result.push({
      source, target, yearRange, voteType, round,
      mean_points: +mean_points.toFixed(2),
      mean_normalized: +mean_normalized.toFixed(4),
      years_active: n,
      consistency: 0,
      trend_slope: 0,
      yearly: sorted.map(r => ({ year: r.year, normalized: r.normalized, points: r.points })),
    });
  }
  return result;
}
