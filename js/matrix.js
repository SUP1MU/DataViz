/* global d3 */
import { state, subscribe, update as stateUpdate } from './state.js';
import { db, getFilteredPairs, getCountrySummary, filterVisibleCodes } from './data.js';
import { show as tipShow, move as tipMove, hide as tipHide, pairHtml } from './tooltip.js';
import { render as legendRender } from './legend.js';

const LABEL_W= 46;
const LABEL_H= 46;

const REGION_ORDER= [
  'Nordic', 'Baltic', 'British Isles', 'Western Europe', 'Iberia',
  'Italic', 'Central Europe', 'Balkans', 'Eastern Europe', 'Caucasus',
  'Levant', 'Maghreb', 'Oceania',
];

let _svg, _g, _container, _legendEl;

// kept between renders so cheap recolor and restroke paths skip the full rebuild
let _cellSel= null;
let _colorScale= null;
let _lastLayoutKey= '';
let _lastThreshold= null;
let _lastPairKey= '';

export function init(containerEl, legendEl) {
  _container= containerEl;
  _legendEl= legendEl;

  _svg= d3.select(containerEl).append('svg').style('display', 'block');
  _g= _svg.append('g').attr('class', 'matrix-g');

  subscribe(_onStateChange);
  _onStateChange();
}

function _layoutKey() {
  return [
    state.yearRange[0], state.yearRange[1],
    state.voteType, state.round, state.sortMode,
    state.regionFilter || '', state.countrySearch || '',
  ].join('|');
}

function _pairKey() {
  return state.selectedPair
    ? `${state.selectedPair.source}::${state.selectedPair.target}`
    : '';
}

function _onStateChange() {
  const layoutKey= _layoutKey();
  if (layoutKey !== _lastLayoutKey) {
    _lastLayoutKey= layoutKey;
    _lastThreshold= state.edgeThreshold;
    _lastPairKey= _pairKey();
    render();
    return;
  }
  if (state.edgeThreshold !== _lastThreshold) {
    _lastThreshold= state.edgeThreshold;
    _recolor();
  }
  const pk= _pairKey();
  if (pk !== _lastPairKey) {
    _lastPairKey= pk;
    _restroke();
  }
}

function _recolor() {
  if (!_cellSel) return;
  _cellSel.attr('fill', d => _fillColor(d, state, _colorScale));
}

function _restroke() {
  if (!_cellSel) return;
  _cellSel
    .attr('stroke', d => _isSelected(d, state) ? '#e63946' : 'none')
    .attr('stroke-width', d => _isSelected(d, state) ? 2 : 0);
}

export function render(st= state) {
  const pairs= getFilteredPairs(st);
  const csData= getCountrySummary(st);

  const csMap= csData.length
    ? Object.fromEntries(csData.map(c => [c.id, c]))
    : _deriveCsMap(pairs);

  const pairMap= new Map(pairs.map(p => [`${p.source}::${p.target}`, p]));

  let codes= filterVisibleCodes(pairs, st);
  if (codes.length === 0) { _g.selectAll('*').remove(); _cellSel= null; return; }

  codes= _sort(codes, st.sortMode, csMap);

  const n= codes.length;

  const cw= _container.clientWidth || 600;
  const cellSize= Math.max(8, Math.min(18, Math.floor((cw-LABEL_W)/n)));
  const svgW= LABEL_W+n*cellSize;
  const svgH= LABEL_H+n*cellSize;
  _svg.attr('width', svgW).attr('height', svgH);

  const maxVal= d3.max(pairs, p => p.mean_normalized) || 1;
  const colorScale= d3.scaleSequential(d3.interpolateBlues).domain([0, maxVal]);
  _colorScale= colorScale;

  const cellData= [];
  for (let i= 0; i < n; i++) {
    for (let j= 0; j < n; j++) {
      const src= codes[i], tgt= codes[j];
      cellData.push({
        src, tgt, i, j,
        pair: src !== tgt ? (pairMap.get(`${src}::${tgt}`) ?? null) : null,
      });
    }
  }

  _cellSel= _g.selectAll('.cell')
    .data(cellData, d => `${d.src}::${d.tgt}`)
    .join('rect')
    .attr('class', 'cell')
    .attr('x', d => LABEL_W+d.j*cellSize)
    .attr('y', d => LABEL_H+d.i*cellSize)
    .attr('width', cellSize-1)
    .attr('height', cellSize-1)
    .attr('fill', d => _fillColor(d, st, colorScale))
    .attr('stroke', d => _isSelected(d, st) ? '#e63946' : 'none')
    .attr('stroke-width', d => _isSelected(d, st) ? 2 : 0)
    .on('mouseover', (event, d) => {
      if (!d.pair) return;
      const sn= db.nodesMap[d.src]?.name || d.src;
      const tn= db.nodesMap[d.tgt]?.name || d.tgt;
      tipShow(event, pairHtml(sn, tn, d.pair));
    })
    .on('mousemove', tipMove)
    .on('mouseout', tipHide)
    .on('click', (_, d) => {
      if (!d.pair) return;
      stateUpdate({
        selectedPair: { source: d.src, target: d.tgt },
        selectedGroupPair: null,
      });
    });

  const fontSize= Math.min(cellSize-2, 11);

  _g.selectAll('.row-label')
    .data(codes, c => c)
    .join('text')
    .attr('class', 'row-label')
    .attr('x', LABEL_W-4)
    .attr('y', (_, i) => LABEL_H+i*cellSize+cellSize*0.6)
    .attr('text-anchor', 'end')
    .attr('font-size', fontSize)
    .attr('fill', '#333')
    .text(c => c);

  _g.selectAll('.col-label')
    .data(codes, c => c)
    .join('text')
    .attr('class', 'col-label')
    .attr('font-size', fontSize)
    .attr('fill', '#333')
    .attr('text-anchor', 'start')
    .attr('x', (_, j) => LABEL_W+j*cellSize+cellSize*0.6)
    .attr('y', LABEL_H-4)
    .attr('transform', (_, j) => {
      const cx= LABEL_W+j*cellSize+cellSize*0.6;
      return `rotate(-90,${cx},${LABEL_H-4})`;
    })
    .text(c => c);

  const showDividers= st.sortMode === 'region' || st.sortMode === 'cluster';
  const divPosns= [];
  if (showDividers) {
    const getGrp= c => {
      const nd= db.nodesMap[c];
      return st.sortMode === 'region' ? (nd?.region ?? '') : (nd?.cluster_id ?? -1);
    };
    for (let i= 1; i < codes.length; i++) {
      if (getGrp(codes[i]) !== getGrp(codes[i-1])) divPosns.push(i);
    }
  }

  _g.selectAll('.div-h')
    .data(divPosns)
    .join('line').attr('class', 'div-h')
    .attr('x1', LABEL_W).attr('x2', LABEL_W+n*cellSize)
    .attr('y1', d => LABEL_H+d*cellSize)
    .attr('y2', d => LABEL_H+d*cellSize)
    .attr('stroke', '#555').attr('stroke-width', 1)
    .attr('pointer-events', 'none');

  _g.selectAll('.div-v')
    .data(divPosns)
    .join('line').attr('class', 'div-v')
    .attr('x1', d => LABEL_W+d*cellSize).attr('x2', d => LABEL_W+d*cellSize)
    .attr('y1', LABEL_H).attr('y2', LABEL_H+n*cellSize)
    .attr('stroke', '#555').attr('stroke-width', 1)
    .attr('pointer-events', 'none');

  if (_legendEl) {
    legendRender(_legendEl, colorScale, 'Mean support (normalized)');
  }
}

function _sort(codes, sortMode, csMap) {
  return [...codes].sort((a, b) => {
    const na= db.nodesMap[a], nb= db.nodesMap[b];
    const nameA= na?.name || a, nameB= nb?.name || b;

    switch (sortMode) {
      case 'alpha':
        return nameA.localeCompare(nameB);

      case 'region': {
        const ra= REGION_ORDER.indexOf(na?.region ?? '');
        const rb= REGION_ORDER.indexOf(nb?.region ?? '');
        return ra !== rb ? ra-rb : nameA.localeCompare(nameB);
      }

      case 'cluster': {
        const ca= na?.cluster_id ?? 999;
        const cb= nb?.cluster_id ?? 999;
        return ca !== cb ? ca-cb : nameA.localeCompare(nameB);
      }

      case 'given': {
        const ga= csMap[a]?.avg_points_given ?? -1;
        const gb= csMap[b]?.avg_points_given ?? -1;
        return gb-ga;
      }

      case 'received': {
        const ra= csMap[a]?.avg_points_received ?? -1;
        const rb= csMap[b]?.avg_points_received ?? -1;
        return rb-ra;
      }

      default: return 0;
    }
  });
}

function _fillColor(d, st, colorScale) {
  if (d.src === d.tgt) return '#dde1e7';
  if (!d.pair) return '#f5f5f5';
  if (st.edgeThreshold > 0 && d.pair.mean_normalized < st.edgeThreshold) return '#f5f5f5';
  return colorScale(d.pair.mean_normalized);
}

function _isSelected(d, st) {
  return !!(
    st.selectedPair &&
    st.selectedPair.source === d.src &&
    st.selectedPair.target === d.tgt
  );
}

function _deriveCsMap(pairs) {
  const given= {}, recv= {};
  for (const p of pairs) {
    if (!given[p.source]) given[p.source]= [];
    if (!recv[p.target]) recv[p.target]= [];
    given[p.source].push(p.mean_normalized);
    recv[p.target].push(p.mean_normalized);
  }
  const all= new Set([...Object.keys(given), ...Object.keys(recv)]);
  const map= {};
  for (const id of all) {
    const g= given[id] || [0];
    const r= recv[id] || [0];
    map[id]= {
      avg_points_given: g.reduce((a, b) => a+b, 0)/g.length,
      avg_points_received: r.reduce((a, b) => a+b, 0)/r.length,
    };
  }
  return map;
}
