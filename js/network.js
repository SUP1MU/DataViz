/* global d3 */
import { state, subscribe, update } from './state.js';
import { db, getFilteredPairs, getCountrySummary, filterVisibleCodes } from './data.js';
import { show as tipShow, move as tipMove, hide as tipHide } from './tooltip.js';

const REGION_ANCHORS= {
  'Nordic': [0.52, 0.08],
  'Baltic': [0.64, 0.20],
  'British Isles': [0.28, 0.18],
  'Western Europe': [0.36, 0.35],
  'Iberia': [0.30, 0.56],
  'Italic': [0.48, 0.58],
  'Central Europe': [0.55, 0.30],
  'Balkans': [0.62, 0.52],
  'Eastern Europe': [0.73, 0.35],
  'Caucasus': [0.86, 0.50],
  'Levant': [0.80, 0.63],
  'Maghreb': [0.38, 0.73],
  'Oceania': [0.90, 0.82],
};

const REGION_COLORS= {
  'Nordic': '#2e5f8a',
  'Baltic': '#3a7a34',
  'British Isles': '#c06a10',
  'Western Europe': '#4a8a87',
  'Iberia': '#b03030',
  'Italic': '#c06070',
  'Central Europe': '#6b4f3a',
  'Balkans': '#7a7570',
  'Eastern Europe': '#b09020',
  'Caucasus': '#7a5080',
  'Levant': '#2a6a65',
  'Maghreb': '#4a8a85',
  'Oceania': '#9a4a6a',
};

let _container, _svg, _gZoom, _gLinks, _gNodes, _gSizeLegend;
let _sim= null;
let _W= 600;
let _H= 400;
let _nodeSel= null;
let _lastKey= '';
const _nodePos= new Map();

export function init(container) {
  _container= container;
  container.innerHTML= '';
  container.style.overflow= 'hidden';

  _W= container.clientWidth || 620;
  _H= container.clientHeight || 420;

  _svg= d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${_W} ${_H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('display', 'block');

  _svg.append('defs')
    .append('marker')
    .attr('id', 'net-arrow')
    .attr('viewBox', '0 -4 10 8')
    .attr('refX', 10)
    .attr('refY', 0)
    .attr('markerWidth', 5)
    .attr('markerHeight', 5)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-4L10,0L0,4Z')
    .attr('fill', '#555');

  _gZoom= _svg.append('g').attr('class', 'net-zoom');
  _gLinks= _gZoom.append('g').attr('class', 'net-links');
  _gNodes= _gZoom.append('g').attr('class', 'net-nodes');

  _svg.on('click', e => {
    if (e.target === _svg.node()) update({ selectedCountry: null });
  });

  _svg.call(d3.zoom()
    .scaleExtent([0.3, 10])
    .on('zoom', e => _gZoom.attr('transform', e.transform)));

  _gSizeLegend= _svg.append('g')
    .attr('class', 'net-size-legend')
    .attr('transform', `translate(10,${_H-10})`);

  _gSizeLegend.append('rect')
    .attr('class', 'net-legend-bg')
    .attr('rx', 5)
    .attr('fill', 'white').attr('fill-opacity', 0.88)
    .attr('stroke', 'var(--border)').attr('stroke-width', 1);

  subscribe(_onStateChange);
  _onStateChange();
}

function _dataKey() {
  return [
    state.yearRange[0], state.yearRange[1],
    state.voteType, state.round,
    state.edgeThreshold,
    state.regionFilter || '',
    state.countrySearch || '',
  ].join('|');
}

function _onStateChange() {
  const key= _dataKey();
  if (key !== _lastKey) {
    _lastKey= key;
    _fullRender();
  } else {
    _updateHighlight();
  }
}

function _updateHighlight() {
  if (!_nodeSel) return;
  _nodeSel.select('circle')
    .attr('stroke', d => _strokeFor(d))
    .attr('stroke-width', d => _strokeWidthFor(d));
}

function _strokeFor(d) {
  if (d.id === state.selectedCountry) return 'var(--accent)';
  if (d.fx != null) return '#1d1d2e';
  return '#fff';
}

function _strokeWidthFor(d) {
  if (d.id === state.selectedCountry) return 3;
  if (d.fx != null) return 2.5;
  return 1.5;
}

function _fullRender() {
  if (_sim) {
    for (const n of _sim.nodes()) {
      _nodePos.set(n.id, { x: n.x, y: n.y, fx: n.fx ?? null, fy: n.fy ?? null });
    }
    _sim.stop();
    _sim= null;
  }

  const pairs= getFilteredPairs(state);
  const csData= getCountrySummary(state);
  const csMap= new Map(csData.map(c => [c.id, c]));

  const codes= filterVisibleCodes(pairs, state);

  if (codes.length === 0) {
    _gLinks.selectAll('*').remove();
    _gNodes.selectAll('*').remove();
    return;
  }

  const codeSet= new Set(codes);
  const maxRecv= d3.max(codes, c => csMap.get(c)?.avg_points_received || 0) || 1;
  const rScale= d3.scaleSqrt().domain([0, maxRecv]).range([5, 18]);

  const nodes= codes.map(code => {
    const cs= csMap.get(code);
    const reg= db.nodesMap[code]?.region;
    const a= REGION_ANCHORS[reg] || [0.5, 0.5];
    const pos= _nodePos.get(code);
    return {
      id: code,
      name: db.nodesMap[code]?.name || code,
      region: reg,
      r: rScale(cs?.avg_points_received || 0),
      tx: a[0]*_W,
      ty: a[1]*_H,
      avgRecv: cs?.avg_points_received || 0,
      avgGiven: cs?.avg_points_given || 0,
      x: pos?.x ?? (a[0]*_W+(Math.random()-0.5)*80),
      y: pos?.y ?? (a[1]*_H+(Math.random()-0.5)*80),
      fx: pos?.fx ?? null,
      fy: pos?.fy ?? null,
    };
  });

  const links= pairs
    .filter(p =>
      codeSet.has(p.source) && codeSet.has(p.target) &&
      (state.edgeThreshold <= 0 || p.mean_normalized >= state.edgeThreshold)
    )
    .map(p => ({ source: p.source, target: p.target, strength: p.mean_normalized }));

  const linkSel= _gLinks.selectAll('line.net-link')
    .data(links, d => `${d.source}::${d.target}`)
    .join('line')
    .attr('class', 'net-link')
    .attr('stroke-width', d => Math.max(0.4, d.strength*4))
    .attr('marker-end', 'url(#net-arrow)');

  _nodeSel= _gNodes.selectAll('g.net-node')
    .data(nodes, d => d.id)
    .join(enter => {
      const g= enter.append('g').attr('class', 'net-node');
      g.append('circle');
      g.append('text')
        .attr('class', 'net-label')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central');
      return g;
    });

  _nodeSel.select('circle')
    .attr('r', d => d.r)
    .attr('fill', d => REGION_COLORS[d.region] || '#aaa')
    .attr('fill-opacity', 0.85)
    .attr('stroke', d => _strokeFor(d))
    .attr('stroke-width', d => _strokeWidthFor(d));

  _nodeSel.select('text')
    .text(d => d.id)
    .attr('font-size', d => Math.max(7, Math.min(10, d.r*0.75)));

  _nodeSel
    .on('mouseover', (event, d) => {
      const pinNote= d.fx != null
        ? `<div class="tip-row"><span style="color:var(--muted);font-style:italic">pinned, double-click to release</span></div>`
        : `<div class="tip-row"><span style="color:var(--muted);font-style:italic">drag to pin</span></div>`;
      tipShow(event, `
        <div class="tip-header">${d.name}</div>
        <div class="tip-row"><span>Region</span><span>${d.region || 'n/a'}</span></div>
        <div class="tip-row"><span>Avg received</span><span>${(d.avgRecv*100).toFixed(1)}%</span></div>
        <div class="tip-row"><span>Avg given</span><span>${(d.avgGiven*100).toFixed(1)}%</span></div>
        ${pinNote}
      `);
    })
    .on('mousemove', tipMove)
    .on('mouseout', tipHide)
    .on('click', (event, d) => {
      if (event.defaultPrevented) return;
      event.stopPropagation();
      update({ selectedCountry: state.selectedCountry === d.id ? null : d.id });
    })
    .on('dblclick', (event, d) => {
      event.stopPropagation();
      d.fx= null;
      d.fy= null;
      _nodePos.set(d.id, { x: d.x, y: d.y, fx: null, fy: null });
      _sim?.alphaTarget(0.2).restart();
      setTimeout(() => _sim?.alphaTarget(0), 600);
      _updateHighlight();
      tipHide();
    })
    .call(d3.drag()
      .on('start', (event, d) => {
        if (!event.active) _sim?.alphaTarget(0.3).restart();
        d.fx= d.x;
        d.fy= d.y;
      })
      .on('drag', (event, d) => {
        d.fx= event.x;
        d.fy= event.y;
      })
      .on('end', (event, d) => {
        if (!event.active) _sim?.alphaTarget(0);
        _nodePos.set(d.id, { x: d.x, y: d.y, fx: d.fx, fy: d.fy });
        _updateHighlight();
      })
    );

  _sim= d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(70).strength(0.3))
    .force('charge', d3.forceManyBody().strength(-150))
    .force('collide', d3.forceCollide(d => d.r+4).strength(0.7))
    .force('center', d3.forceCenter(_W/2, _H/2).strength(0.03))
    .force('x', d3.forceX(d => d.tx).strength(0.08))
    .force('y', d3.forceY(d => d.ty).strength(0.08))
    .alpha(0.5)
    .on('tick', () => {
      linkSel
        .attr('x1', d => d.source.x)
        .attr('y1', d => d.source.y)
        .attr('x2', d => {
          const dx= d.target.x-d.source.x;
          const dy= d.target.y-d.source.y;
          const len= Math.hypot(dx, dy) || 1;
          return d.target.x-(dx/len)*(d.target.r+10);
        })
        .attr('y2', d => {
          const dx= d.target.x-d.source.x;
          const dy= d.target.y-d.source.y;
          const len= Math.hypot(dx, dy) || 1;
          return d.target.y-(dy/len)*(d.target.r+10);
        });

      _nodeSel.attr('transform', d => `translate(${d.x.toFixed(1)},${d.y.toFixed(1)})`);
    });

  _updateSizeLegend(rScale, maxRecv);
}

function _updateSizeLegend(rScale, maxRecv) {
  if (!_gSizeLegend) return;
  _gSizeLegend.selectAll('.net-lgnd-item').remove();
  _gSizeLegend.select('.net-legend-bg').attr('width', 0).attr('height', 0);

  const vals= [0, maxRecv*0.5, maxRecv];
  const labels= ['Low', 'Mid', 'High'];
  const radii= vals.map(v => rScale(v));

  const PAD= 8;
  const maxR= radii[2];
  const rowH= maxR*2+6;
  const circlesW= PAD+radii.reduce((sum, r, i) => sum+r*2+(i < 2 ? 28 : 0), 0)+PAD;
  const totalW= Math.max(170, circlesW);
  const totalH= PAD+rowH+14+PAD;

  _gSizeLegend.attr('transform', `translate(10,${_H-totalH-6})`);

  _gSizeLegend.select('.net-legend-bg')
    .attr('width', totalW).attr('height', totalH);

  _gSizeLegend.append('text')
    .attr('class', 'net-lgnd-item lgnd-title')
    .attr('x', PAD).attr('y', PAD+10)
    .attr('font-size', 8)
    .attr('font-weight', 700)
    .attr('fill', 'var(--muted)')
    .text('Size = avg votes received');

  let cx= PAD;
  vals.forEach((v, i) => {
    const r= radii[i];
    cx+= r;
    const cy= PAD+14+maxR;

    _gSizeLegend.append('circle')
      .attr('class', 'net-lgnd-item')
      .attr('cx', cx).attr('cy', cy).attr('r', r)
      .attr('fill', '#888').attr('fill-opacity', 0.55)
      .attr('stroke', '#555').attr('stroke-width', 0.8);

    _gSizeLegend.append('text')
      .attr('class', 'net-lgnd-item')
      .attr('x', cx).attr('y', cy+maxR+9)
      .attr('text-anchor', 'middle')
      .attr('font-size', 8)
      .attr('fill', 'var(--muted)')
      .text(labels[i]);

    cx+= r+(i < 2 ? 28 : PAD);
  });
}
