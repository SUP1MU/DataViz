/* global d3 */
import { state, subscribe } from './state.js';
import { db } from './data.js';

const MAR= { top: 30, right: 20, bottom: 36, left: 44 };

let _container;
let _lastKey= '';

export function init(container) {
  _container= container;
  container.innerHTML= '';
  subscribe(_onStateChange);
  _onStateChange();
}

function _onStateChange() {
  const group= state.selectedGroupPair;
  const pair= state.selectedPair;
  let key;
  if (group) {
    key= `g::${group.aRegion}::${group.bRegion}::${state.voteType}::${state.yearRange[0]}::${state.yearRange[1]}`;
  } else if (pair) {
    key= `p::${pair.source}::${pair.target}`;
  } else {
    key= '';
  }
  if (key === _lastKey) return;
  _lastKey= key;

  if (group) _renderGroup(group);
  else if (pair) _renderPair(pair);
  else _renderPlaceholder('Click a matrix cell, or pick two regions to compare');
}

function _renderPair(pair) {
  const raw= (db.edgesAll || []).filter(e =>
    e.source === pair.source &&
    e.target === pair.target &&
    e.round === 'final'
  );

  const byYear= new Map();
  for (const e of raw) {
    if (!byYear.has(e.year)) byYear.set(e.year, {});
    byYear.get(e.year)[e.voteType]= e.normalized;
  }
  const years= [...byYear.keys()].sort((a, b) => a-b);
  if (years.length === 0) {
    _renderPlaceholder(`No data found for ${pair.source} to ${pair.target}`);
    return;
  }

  const VT_LABELS= { total: 'Total', jury: 'Jury', public: 'Televote' };
  const _series= (voteType, color, dash) => ({
    label: VT_LABELS[voteType],
    color, dash,
    pts: years.flatMap(y => {
      const v= byYear.get(y)?.[voteType];
      return v != null ? [{ year: y, val: v }] : [];
    }),
  });

  const series= [
    _series('total', '#444', null),
    _series('jury', '#1a54a9', '5,3'),
    _series('public', '#b05010', '5,3'),
  ].filter(s => s.pts.length > 0);

  const srcName= db.nodesMap[pair.source]?.name || pair.source;
  const tgtName= db.nodesMap[pair.target]?.name || pair.target;
  const hasSplit= series.some(s => s.label === 'Jury' || s.label === 'Televote');

  _drawChart({
    title: `${srcName} to ${tgtName}`,
    series,
    yearExt: d3.extent(years),
    showLegend: hasSplit,
  });
}

function _renderGroup(group) {
  const aMembers= new Set(db.nodes.filter(n => n.region === group.aRegion).map(n => n.id));
  const bMembers= new Set(db.nodes.filter(n => n.region === group.bRegion).map(n => n.id));

  if (aMembers.size === 0 || bMembers.size === 0) {
    _renderPlaceholder(`No countries in ${group.aRegion} or ${group.bRegion}`);
    return;
  }

  const vt= state.voteType;
  const edges= (db.edgesAll || []).filter(e =>
    e.round === 'final' && e.voteType === vt
  );

  const sumsAB= new Map();
  const sumsBA= new Map();
  for (const e of edges) {
    if (aMembers.has(e.source) && bMembers.has(e.target)) {
      const bucket= sumsAB.get(e.year) || { sum: 0, n: 0 };
      bucket.sum+= e.normalized;
      bucket.n+= 1;
      sumsAB.set(e.year, bucket);
    } else if (bMembers.has(e.source) && aMembers.has(e.target)) {
      const bucket= sumsBA.get(e.year) || { sum: 0, n: 0 };
      bucket.sum+= e.normalized;
      bucket.n+= 1;
      sumsBA.set(e.year, bucket);
    }
  }

  const _meanPts= (m) => [...m.entries()]
    .map(([year, { sum, n }]) => ({ year, val: sum/n }))
    .sort((a, b) => a.year-b.year);

  const ptsAB= _meanPts(sumsAB);
  const ptsBA= _meanPts(sumsBA);

  if (ptsAB.length === 0 && ptsBA.length === 0) {
    _renderPlaceholder(`No ${vt} votes recorded between ${group.aRegion} and ${group.bRegion}`);
    return;
  }

  const allYears= [...new Set([...ptsAB.map(p => p.year), ...ptsBA.map(p => p.year)])];
  const yearExt= d3.extent(allYears);

  const series= [
    { label: `${group.aRegion} to ${group.bRegion}`, color: '#1a54a9', dash: null, pts: ptsAB },
    { label: `${group.bRegion} to ${group.aRegion}`, color: '#b05010', dash: null, pts: ptsBA },
  ].filter(s => s.pts.length > 0);

  const vtLabel= vt === 'public' ? 'televote' : vt;
  _drawChart({
    title: `${group.aRegion} vs ${group.bRegion}, mean ${vtLabel} per year`,
    series,
    yearExt,
    showLegend: true,
  });
}

function _renderPlaceholder(msg) {
  _container.innerHTML= '';
  const W= _container.clientWidth || 500;
  const H= _container.clientHeight || 300;
  d3.select(_container).append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('display', 'block')
    .append('text')
      .attr('x', W/2).attr('y', H/2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'var(--muted)')
      .attr('font-size', 13)
      .attr('font-style', 'italic')
      .text(msg);
}

function _drawChart({ title, series, yearExt, showLegend }) {
  _container.innerHTML= '';

  const W= _container.clientWidth || 500;
  const H= _container.clientHeight || 300;
  const iW= W-MAR.left-MAR.right;
  const iH= H-MAR.top-MAR.bottom;

  const svg= d3.select(_container).append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('display', 'block');

  const xSc= d3.scaleLinear().domain(yearExt).range([0, iW]);
  const ySc= d3.scaleLinear().domain([0, 1]).range([iH, 0]).nice();
  const g= svg.append('g').attr('transform', `translate(${MAR.left},${MAR.top})`);

  if (yearExt[0] < 2016) {
    const bandW= Math.min(xSc(2016), iW);
    g.append('rect')
      .attr('x', 0).attr('y', 0)
      .attr('width', bandW).attr('height', iH)
      .attr('fill', '#f0f0f4').attr('fill-opacity', 0.8);
    g.append('text')
      .attr('x', 4).attr('y', 12)
      .attr('class', 'tl-band-label')
      .text('combined vote only');
  }

  const _ann= (year, label) => {
    if (year < yearExt[0] || year > yearExt[1]) return;
    const x= xSc(year);
    g.append('line')
      .attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', iH)
      .attr('class', 'tl-ann-line');
    g.append('text')
      .attr('x', x+3).attr('y', iH-5)
      .attr('class', 'tl-ann-label')
      .text(label);
  };
  _ann(1975, '12-pt rule');
  _ann(2016, 'jury/public split');

  if (yearExt[0] <= 2020 && yearExt[1] >= 2020) {
    const x20= xSc(2020);
    g.append('line')
      .attr('x1', x20).attr('x2', x20).attr('y1', 0).attr('y2', iH)
      .attr('stroke', '#e63946').attr('stroke-width', 1)
      .attr('stroke-dasharray', '3,2').attr('opacity', 0.5);
    g.append('text')
      .attr('x', x20+3).attr('y', 14)
      .attr('class', 'tl-ann-label').attr('fill', '#e63946')
      .text('cancelled');
  }

  const lineGen= pts => d3.line()
    .x(d => xSc(d.year))
    .y(d => ySc(d.val))
    .curve(d3.curveMonotoneX)(pts);

  for (const s of series) {
    if (s.pts.length >= 2) {
      g.append('path')
        .attr('d', lineGen(s.pts))
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 1.8)
        .attr('stroke-dasharray', s.dash || '')
        .attr('stroke-linejoin', 'round')
        .attr('stroke-linecap', 'round');
    }
    g.selectAll(null).data(s.pts).join('circle')
      .attr('cx', d => xSc(d.year))
      .attr('cy', d => ySc(d.val))
      .attr('r', 3)
      .attr('fill', s.color)
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.8);
  }

  const xTicks= Math.min(yearExt[1]-yearExt[0]+1, Math.floor(iW/40));
  g.append('g')
    .attr('transform', `translate(0,${iH})`)
    .call(d3.axisBottom(xSc).ticks(xTicks).tickFormat(d3.format('d')))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('class', 'tl-axis-text');

  g.append('g')
    .call(d3.axisLeft(ySc).ticks(4).tickFormat(d => (d*100).toFixed(0)+'%'))
    .call(a => a.select('.domain').remove())
    .selectAll('text').attr('class', 'tl-axis-text');

  g.append('text')
    .attr('transform', 'rotate(-90)')
    .attr('x', -(iH/2)).attr('y', -32)
    .attr('text-anchor', 'middle')
    .attr('class', 'tl-axis-label')
    .text('Normalized score');

  svg.append('text')
    .attr('x', MAR.left).attr('y', 18)
    .attr('class', 'tl-title')
    .text(title);

  if (showLegend && series.length > 0) {
    const longest= Math.max(...series.map(s => s.label.length));
    const lgX= W-MAR.right-Math.max(62, longest*6+22);
    series.forEach((s, i) => {
      const ly= MAR.top+5+i*15;
      svg.append('line')
        .attr('x1', lgX).attr('x2', lgX+16)
        .attr('y1', ly).attr('y2', ly)
        .attr('stroke', s.color).attr('stroke-width', 1.8)
        .attr('stroke-dasharray', s.dash || '');
      svg.append('text')
        .attr('x', lgX+20).attr('y', ly+4)
        .attr('class', 'tl-legend-item')
        .text(s.label);
    });
  }
}
