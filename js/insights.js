import { db } from './data.js';
import { update } from './state.js';

let _computed= false;
let _q1= [], _q2= [], _q3= [];

// full datasets for each question (not sliced to 10)
let _q1Full= [], _q2Full= [], _q3Full= [];

// browser state
let _browserOpen= false;
let _browserContext= 'q1';      // 'q1' | 'q2' | 'q3' — controls which data + columns
let _browserSort= 'primary';    // 'primary' | 'years'
let _browserSortDir= -1;        // -1 = desc, 1 = asc
let _lastActiveQ= null;

function _compute() {
  if (_computed) return;
  _computed= true;

  const modern= db.pairSummary.filter(p =>
    p.yearRange[0] === 2016 && p.yearRange[1] === 2025 &&
    p.voteType === 'total' && p.round === 'final'
  );
  const historic= db.pairSummary.filter(p =>
    p.yearRange[0] === 1957 && p.yearRange[1] === 2025 &&
    p.voteType === 'total' && p.round === 'final'
  );
  const historicMap= new Map(historic.map(p => [`${p.source}::${p.target}`, p]));

  _q1Full= [...modern]
    .filter(p => p.years_active >= 6)
    .sort((a, b) => b.mean_normalized-a.mean_normalized)
    .map(p => ({
      source: p.source,
      target: p.target,
      label: `${_name(p.source)} to ${_name(p.target)}`,
      value: `${(p.mean_normalized*100).toFixed(0)}%`,
      valueSortKey: p.mean_normalized,
      years: p.years_active,
    }));
  _q1= _q1Full.slice(0, 10).map(p => ({ ...p, sub: `${p.years} yrs` }));

  const shifts= [];
  for (const mp of modern) {
    const hp= historicMap.get(`${mp.source}::${mp.target}`);
    if (!hp || hp.years_active < 5) continue;
    const delta= mp.mean_normalized-hp.mean_normalized;
    shifts.push({ ...mp, delta, historic: hp.mean_normalized });
  }
  // full q2: all shifts sorted by absolute delta descending
  _q2Full= shifts
    .sort((a, b) => Math.abs(b.delta)-Math.abs(a.delta))
    .map(p => ({
      source: p.source,
      target: p.target,
      label: `${_name(p.source)} to ${_name(p.target)}`,
      value: (p.delta >= 0 ? '+' : '')+`${(p.delta*100).toFixed(0)}%`,
      valueSortKey: p.delta,
      years: p.years_active,
      sub: `${(p.historic*100).toFixed(0)}% hist, ${(p.mean_normalized*100).toFixed(0)}% now`,
      rise: p.delta >= 0,
    }));

  // top-10: 6 biggest risers + 4 biggest fallers
  const risers= shifts.filter(p => p.delta > 0).sort((a, b) => b.delta-a.delta).slice(0, 6);
  const fallers= shifts.filter(p => p.delta < 0).sort((a, b) => a.delta-b.delta).slice(0, 4);
  _q2= [...risers, ...fallers].map(p => ({
    source: p.source,
    target: p.target,
    label: `${_name(p.source)} to ${_name(p.target)}`,
    value: (p.delta >= 0 ? '+' : '')+`${(p.delta*100).toFixed(0)}%`,
    sub: `${(p.historic*100).toFixed(0)}% historic, ${(p.mean_normalized*100).toFixed(0)}% modern`,
    rise: p.delta >= 0,
  }));

  const juryMap= new Map(), publicMap= new Map();
  for (const e of (db.edgesAll || [])) {
    if (e.year < 2016 || e.round !== 'final') continue;
    const key= `${e.source}::${e.target}`;
    if (e.voteType === 'jury') {
      const b= juryMap.get(key) || { sum: 0, n: 0, years: new Set() };
      b.sum+= e.normalized; b.n++; b.years.add(e.year);
      juryMap.set(key, b);
    } else if (e.voteType === 'public') {
      const b= publicMap.get(key) || { sum: 0, n: 0, years: new Set() };
      b.sum+= e.normalized; b.n++; b.years.add(e.year);
      publicMap.set(key, b);
    }
  }
  const gaps= [];
  for (const [key, jb] of juryMap) {
    const pb= publicMap.get(key);
    if (!pb) continue;
    const j= jb.sum/jb.n, p= pb.sum/pb.n;
    const [source, target]= key.split('::');
    const sharedYears= [...jb.years].filter(y => pb.years.has(y)).length;
    gaps.push({ source, target, jury: j, pub: p, gap: Math.abs(j-p), years: sharedYears });
  }
  gaps.sort((a, b) => b.gap-a.gap);
  const gapsFiltered= gaps.filter(p => p.years >= 4);
  _q3Full= gapsFiltered.map(p => ({
    source: p.source,
    target: p.target,
    label: `${_name(p.source)} to ${_name(p.target)}`,
    value: `gap ${(p.gap*100).toFixed(0)}%`,
    valueSortKey: p.gap,
    years: p.years,
    sub: `jury ${(p.jury*100).toFixed(0)}%, public ${(p.pub*100).toFixed(0)}%`,
  }));
  _q3= _q3Full.slice(0, 10).map(p => ({ ...p, sub: p.sub+` · ${p.years} yrs` }));
}

function _name(code) {
  return db.nodesMap[code]?.name || code;
}

function _showPanel(list, title, qKey) {
  const section= document.getElementById('insights-section');
  const titleEl= document.getElementById('insights-title');
  const listEl= document.getElementById('insights-list');
  const browser= document.getElementById('pairs-browser');
  if (!section || !titleEl || !listEl) return;

  _browserOpen= false;
  _lastActiveQ= qKey;
  if (browser) browser.style.display= 'none';
  listEl.style.display= '';   // clear the display:none set by _openBrowser

  titleEl.textContent= title;
  listEl.innerHTML= '';

  list.forEach((item, i) => {
    const row= document.createElement('button');
    row.type= 'button';
    row.className= 'insight-row';
    if (item.rise === true)  row.classList.add('insight-rise');
    if (item.rise === false) row.classList.add('insight-fall');

    row.innerHTML=
      `<span class="insight-rank">${i+1}</span>`+
      `<span class="insight-label">${item.label}</span>`+
      `<span class="insight-meta"><b>${item.value}</b><br><small>${item.sub}</small></span>`;

    row.addEventListener('click', () => {
      update({
        selectedPair: { source: item.source, target: item.target },
        selectedGroupPair: null,
      });
    });

    listEl.appendChild(row);
  });

  // browse-all button at the bottom
  const browseBtn= document.createElement('button');
  browseBtn.type= 'button';
  browseBtn.className= 'pb-browse-all';
  browseBtn.textContent= 'Browse all pairs';
  browseBtn.addEventListener('click', () => _openBrowser(qKey));
  listEl.appendChild(browseBtn);

  section.style.display= 'block';
}

// ── pairs browser ─────────────────────────────────────────────────────────────

function _fullDataForContext() {
  if (_browserContext === 'q2') return _q2Full;
  if (_browserContext === 'q3') return _q3Full;
  return _q1Full;
}

function _openBrowser(context) {
  const listEl= document.getElementById('insights-list');
  const browser= document.getElementById('pairs-browser');
  const titleEl= document.getElementById('insights-title');
  if (!listEl || !browser) return;

  listEl.style.display= 'none';
  browser.style.display= 'block';
  _browserOpen= true;
  _browserContext= context || _lastActiveQ || 'q1';
  _browserSort= 'primary';
  _browserSortDir= -1;

  // update sort header labels to match the context
  const suppEl= document.getElementById('pb-sort-support');
  if (suppEl) {
    suppEl.textContent= _browserContext === 'q3' ? 'Gap ▾'
                      : _browserContext === 'q2' ? 'Shift ▾'
                      : 'Support ▾';
  }

  const total= _fullDataForContext().length;
  if (titleEl) titleEl.textContent= `All — ${total} pairs`;

  _updateSortHeaders();
  _renderBrowser();

  const searchEl= document.getElementById('pb-search');
  if (searchEl) { searchEl.value= ''; searchEl.focus(); }
}

function _renderBrowser() {
  const rowsEl= document.getElementById('pb-rows');
  if (!rowsEl) return;

  const q= (document.getElementById('pb-search')?.value || '').trim().toLowerCase();
  let items= [..._fullDataForContext()];

  if (q) {
    items= items.filter(p =>
      p.label.toLowerCase().includes(q) ||
      p.source.toLowerCase().includes(q) ||
      p.target.toLowerCase().includes(q)
    );
  }

  if (_browserSort === 'primary') {
    // q2: sort by absolute delta so risers and fallers interleave when reversed
    if (_browserContext === 'q2') {
      items.sort((a, b) => _browserSortDir*(Math.abs(b.valueSortKey)-Math.abs(a.valueSortKey)));
    } else {
      items.sort((a, b) => _browserSortDir*(b.valueSortKey-a.valueSortKey));
    }
  } else {
    items.sort((a, b) => _browserSortDir*(b.years-a.years));
  }

  rowsEl.innerHTML= '';

  if (items.length === 0) {
    const empty= document.createElement('div');
    empty.className= 'pb-empty';
    empty.textContent= 'No pairs match that search.';
    rowsEl.appendChild(empty);
    return;
  }

  const frag= document.createDocumentFragment();
  for (const p of items) {
    const row= document.createElement('button');
    row.type= 'button';
    row.className= 'pb-row';
    if (p.rise === true)  row.classList.add('insight-rise');
    if (p.rise === false) row.classList.add('insight-fall');
    row.innerHTML=
      `<span class="pb-row-name">${p.label}</span>`+
      `<span class="pb-row-val">${p.value}</span>`+
      `<span class="pb-row-yrs">${p.years}y</span>`;
    row.addEventListener('click', () => {
      update({ selectedPair: { source: p.source, target: p.target }, selectedGroupPair: null });
    });
    frag.appendChild(row);
  }
  rowsEl.appendChild(frag);
}

function _updateSortHeaders() {
  const suppEl= document.getElementById('pb-sort-support');
  const yrsEl= document.getElementById('pb-sort-years');
  if (!suppEl || !yrsEl) return;
  const arrow= _browserSortDir === -1 ? ' ▾' : ' ▴';
  const primaryLabel= _browserContext === 'q3' ? 'Gap'
                    : _browserContext === 'q2' ? 'Shift'
                    : 'Support';
  suppEl.textContent= primaryLabel+(_browserSort === 'primary' ? arrow : '');
  yrsEl.textContent=  'Yrs'+(_browserSort === 'years' ? arrow : '');
  suppEl.classList.toggle('pb-sort-active', _browserSort === 'primary');
  yrsEl.classList.toggle('pb-sort-active', _browserSort === 'years');
}

export function isBrowserOpen() { return _browserOpen; }

export function showQ1() { _compute(); _showPanel(_q1, 'Q1 — most consistent pairs', 'q1'); }
export function showQ2() { _compute(); _showPanel(_q2, 'Q2 — biggest shifts', 'q2'); }
export function showQ3() { _compute(); _showPanel(_q3, 'Q3 — jury vs public gap', 'q3'); }

export function hidePanel() {
  const s= document.getElementById('insights-section');
  if (s) s.style.display= 'none';
  _browserOpen= false;
}

export function init() {
  _compute();

  // sort header clicks
  document.getElementById('pb-sort-support')?.addEventListener('click', () => {
    if (_browserSort === 'primary') { _browserSortDir *= -1; } else { _browserSort= 'primary'; _browserSortDir= -1; }
    _updateSortHeaders();
    _renderBrowser();
  });
  document.getElementById('pb-sort-years')?.addEventListener('click', () => {
    if (_browserSort === 'years') { _browserSortDir *= -1; } else { _browserSort= 'years'; _browserSortDir= -1; }
    _updateSortHeaders();
    _renderBrowser();
  });

  // search
  document.getElementById('pb-search')?.addEventListener('input', () => _renderBrowser());

  // back button — return to whichever Q panel was last shown
  document.getElementById('pb-back')?.addEventListener('click', () => {
    _browserOpen= false;
    const listEl= document.getElementById('insights-list');
    const browser= document.getElementById('pairs-browser');
    if (listEl) listEl.style.display= '';
    if (browser) browser.style.display= 'none';
    const titleMap= { q1: 'Q1 — most consistent pairs', q2: 'Q2 — biggest shifts', q3: 'Q3 — jury vs public gap' };
    const titleEl= document.getElementById('insights-title');
    if (titleEl && _lastActiveQ) titleEl.textContent= titleMap[_lastActiveQ] || 'Top findings';
  });
}
