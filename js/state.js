export const state= {
  yearRange: [2016, 2025],
  voteType: 'total',
  round: 'final',
  sortMode: 'cluster',
  edgeThreshold: 0,
  regionFilter: null,
  countrySearch: '',
  selectedCountry: null,
  selectedPair: null,
  selectedGroupPair: null,
  showFullHistory: false,
};

const _listeners= new Set();

export function subscribe(fn) {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

export function update(patch) {
  Object.assign(state, patch);
  for (const fn of _listeners) fn(state);
}
