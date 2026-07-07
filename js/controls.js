import { state, update, subscribe } from './state.js';
import { db } from './data.js';

export function init() {
  const strip= document.getElementById('controls-strip');

  const allYears= db.meta.years_included;
  const allRegions= [...new Set(db.nodes.map(n => n.region).filter(Boolean))].sort();

  const yearStart= _select('year-start', allYears.map(y => [y, y]));
  const yearEnd= _select('year-end', allYears.map(y => [y, y]));
  yearStart.value= state.yearRange[0];
  yearEnd.value= state.yearRange[1];

  yearStart.addEventListener('change', () => {
    const y0= +yearStart.value;
    const y1= Math.max(y0, +yearEnd.value);
    yearEnd.value= y1;
    update({ yearRange: [y0, y1] });
  });
  yearEnd.addEventListener('change', () => {
    const y1= +yearEnd.value;
    const y0= Math.min(y1, +yearStart.value);
    yearStart.value= y0;
    update({ yearRange: [y0, y1] });
  });

  const vtGroup= _voteTypeGroup();
  vtGroup.addEventListener('change', e => {
    if (e.target.name === 'voteType') update({ voteType: e.target.value });
  });

  const sortSel= _select('sort-mode', [
    ['cluster', 'By cluster'],
    ['region', 'By region'],
    ['alpha', 'Alphabetical'],
    ['given', 'Given (down)'],
    ['received', 'Received (down)'],
  ]);
  sortSel.value= state.sortMode;
  sortSel.addEventListener('change', () => update({ sortMode: sortSel.value }));

  // the label updates immediately but the actual state update is coalesced
  // to one per animation frame so dragging stays smooth
  const [threshWrap, threshVal]= _slider('edge-threshold', 0, 1, 0.01, state.edgeThreshold);
  let _threshRaf= null;
  let _threshPending= state.edgeThreshold;
  threshWrap.querySelector('input').addEventListener('input', e => {
    const v= +e.target.value;
    threshVal.textContent= (v*100).toFixed(0)+'%';
    _threshPending= v;
    if (_threshRaf == null) {
      _threshRaf= requestAnimationFrame(() => {
        _threshRaf= null;
        update({ edgeThreshold: _threshPending });
      });
    }
  });

  const [yearsWrap, yearsVal]= _slider('years-active', 1, 10, 1, state.yearsActive);
  let _yearsRaf= null;
  let _yearsPending= state.yearsActive;
  yearsWrap.querySelector('input').addEventListener('input', e => {
    const v= +e.target.value;
    yearsVal.textContent= v === 1 ? 'any' : v+'+';
    _yearsPending= v;
    if (_yearsRaf == null) {
      _yearsRaf= requestAnimationFrame(() => {
        _yearsRaf= null;
        update({ yearsActive: _yearsPending });
      });
    }
  });
  yearsVal.textContent= 'any';

  const regionSel= _select('region-filter',
    [['', 'All regions'], ...allRegions.map(r => [r, r])]
  );
  regionSel.addEventListener('change', () =>
    update({ regionFilter: regionSel.value || null })
  );

  const search= document.createElement('input');
  search.type= 'search';
  search.id= 'country-search';
  search.placeholder= 'Search country';
  search.value= state.countrySearch;
  search.addEventListener('input', () => update({ countrySearch: search.value }));

  const histLabel= document.createElement('label');
  histLabel.className= 'history-wrap';
  const histCheck= document.createElement('input');
  histCheck.type= 'checkbox';
  histCheck.id= 'full-history';
  histCheck.checked= state.showFullHistory;
  histLabel.appendChild(histCheck);
  histLabel.insertAdjacentText('beforeend', ' Full history (1957 and on)');

  histCheck.addEventListener('change', () => {
    const on= histCheck.checked;
    if (on) {
      yearStart.value= 1957;
      yearEnd.value= 2025;
      vtGroup.querySelector('input[value=total]').checked= true;
      update({ showFullHistory: true, yearRange: [1957, 2025], voteType: 'total' });
    } else {
      yearStart.value= 2016;
      yearEnd.value= 2025;
      update({ showFullHistory: false, yearRange: [2016, 2025] });
    }
    vtGroup.querySelectorAll('input').forEach(i => { i.disabled= on; });
    yearStart.disabled= on;
    yearEnd.disabled= on;
  });

  const REGION_PLACEHOLDER= 'select';
  const groupA= _select('group-a',
    [['', REGION_PLACEHOLDER], ...allRegions.map(r => [r, r])]
  );
  const groupB= _select('group-b',
    [['', REGION_PLACEHOLDER], ...allRegions.map(r => [r, r])]
  );
  const groupClear= document.createElement('button');
  groupClear.type= 'button';
  groupClear.className= 'btn-mini';
  groupClear.textContent= 'Clear';
  groupClear.title= 'Clear group comparison';

  const _syncGroups= () => {
    const a= groupA.value;
    const b= groupB.value;
    if (a && b && a !== b) {
      update({ selectedGroupPair: { aRegion: a, bRegion: b }, selectedPair: null });
    } else {
      update({ selectedGroupPair: null });
    }
  };
  groupA.addEventListener('change', _syncGroups);
  groupB.addEventListener('change', _syncGroups);
  groupClear.addEventListener('click', () => {
    groupA.value= '';
    groupB.value= '';
    update({ selectedGroupPair: null });
  });

  // only reset dropdowns when a complete group is cleared externally
  // not when the user is mid-selection
  let _lastGroupKey= '';
  subscribe(st => {
    const newKey= st.selectedGroupPair
      ? `${st.selectedGroupPair.aRegion}::${st.selectedGroupPair.bRegion}`
      : '';
    if (_lastGroupKey && !newKey) {
      groupA.value= '';
      groupB.value= '';
    }
    _lastGroupKey= newKey;
  });

  const exportBtn= document.createElement('button');
  exportBtn.type= 'button';
  exportBtn.className= 'btn-mini';
  exportBtn.textContent= 'Export map SVG';
  exportBtn.title= 'Download the current map as an SVG file';
  exportBtn.addEventListener('click', () => _exportMapSvg());

  strip.appendChild(_group('Years', _row([yearStart, _text('to'), yearEnd])));
  strip.appendChild(_sep());
  strip.appendChild(_group('Vote type', vtGroup));
  strip.appendChild(_sep());
  strip.appendChild(_group('Sort', sortSel));
  strip.appendChild(_sep());
  strip.appendChild(_group('Mean support', threshWrap));
  strip.appendChild(_sep());
  strip.appendChild(_group('Min years', yearsWrap));
  strip.appendChild(_sep());
  strip.appendChild(_group('Region', regionSel));
  strip.appendChild(_sep());
  strip.appendChild(search);
  strip.appendChild(_sep());
  strip.appendChild(histLabel);
  strip.appendChild(_sep());
  strip.appendChild(_group('Compare regions',
    _row([groupA, _text('vs'), groupB, groupClear])));
  strip.appendChild(_sep());
  strip.appendChild(exportBtn);
}

function _exportMapSvg() {
  const svgEl= document.querySelector('#map svg');
  if (!svgEl) return;

  const clone= svgEl.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');

  const style= document.createElement('style');
  style.textContent= `
    .map-country  { stroke-linejoin: round; }
    .map-arc      { fill: none; }
    text          { font-family: system-ui, -apple-system, "Segoe UI", Arial, sans-serif; }
    .lgnd-title   { font-size: 10px; font-weight: 700; fill: #666; }
    .lgnd-tick    { font-size: 10px; fill: #888; }
    .lgnd-section { font-size: 10px; font-weight: 700; fill: #888; }
    .lgnd-item    { font-size: 11px; fill: #1a1a2e; }
    .lgnd-arc     { fill: none; stroke-width: 2; stroke-linecap: round; }
    .lgnd-sep     { stroke: #d0d0d8; stroke-width: 1; }
  `;
  clone.insertBefore(style, clone.firstChild);

  const xml= new XMLSerializer().serializeToString(clone);
  const blob= new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`],
                       { type: 'image/svg+xml;charset=utf-8' });
  const url= URL.createObjectURL(blob);

  const a= document.createElement('a');
  a.href= url;
  const stamp= new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download= `eurovision-map-${stamp}.svg`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function _el(tag, cls) {
  const el= document.createElement(tag);
  if (cls) el.className= cls;
  return el;
}

function _text(str) {
  const s= _el('span');
  s.textContent= str;
  return s;
}

function _row(children) {
  const d= _el('div', 'ctrl-row');
  children.forEach(c => d.appendChild(c));
  return d;
}

function _group(label, child) {
  const wrap= _el('div', 'ctrl-group');
  const lbl= _el('span', 'ctrl-label');
  lbl.textContent= label;
  wrap.appendChild(lbl);
  wrap.appendChild(child);
  return wrap;
}

function _sep() { return _el('div', 'ctrl-sep'); }

function _select(id, options) {
  const sel= _el('select');
  sel.id= id;
  options.forEach(([val, label]) => {
    const opt= _el('option');
    opt.value= val;
    opt.textContent= label;
    sel.appendChild(opt);
  });
  return sel;
}

function _voteTypeGroup() {
  const group= _el('div', 'segmented');
  group.setAttribute('role', 'group');
  [['jury', 'Jury'], ['public', 'Televote'], ['total', 'Total']].forEach(([val, label]) => {
    const inp= _el('input');
    inp.type= 'radio';
    inp.name= 'voteType';
    inp.id= `vt-${val}`;
    inp.value= val;
    if (val === state.voteType) inp.checked= true;
    const lbl= _el('label');
    lbl.htmlFor= inp.id;
    lbl.textContent= label;
    group.appendChild(inp);
    group.appendChild(lbl);
  });
  return group;
}

function _slider(id, min, max, step, value) {
  const wrap= _el('div', 'slider-wrap');
  const inp= _el('input');
  inp.type= 'range';
  inp.id= id;
  inp.min= min;
  inp.max= max;
  inp.step= step;
  inp.value= value;
  const val= _el('span', 'slider-val');
  val.textContent= (value*100).toFixed(0)+'%';
  wrap.appendChild(inp);
  wrap.appendChild(val);
  return [wrap, val];
}
