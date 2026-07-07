/* global d3, topojson */
import { state, subscribe, update } from './state.js';
import { db, getCountrySummary, getCountrySummaryMap, getCountryStats } from './data.js';
import { show as tipShow, move as tipMove, hide as tipHide } from './tooltip.js';

// iso numeric id to iso-2 code for every eurovision country
// micro-states (ad, mt, mc, sm) are absent from the 110m topojson so they
// are drawn as pin markers instead
const ISO_NUM= {
  '008': 'AL', '031': 'AZ', '036': 'AU', '040': 'AT', '051': 'AM',
  '056': 'BE', '070': 'BA', '100': 'BG', '112': 'BY', '191': 'HR',
  '196': 'CY', '203': 'CZ', '208': 'DK', '233': 'EE', '246': 'FI',
  '250': 'FR', '268': 'GE', '276': 'DE', '300': 'GR', '348': 'HU',
  '352': 'IS', '372': 'IE', '376': 'IL', '380': 'IT', '398': 'KZ',
  '428': 'LV', '440': 'LT', '442': 'LU', '498': 'MD', '499': 'ME',
  '504': 'MA', '528': 'NL', '578': 'NO', '616': 'PL', '620': 'PT',
  '642': 'RO', '643': 'RU', '688': 'RS', '703': 'SK', '705': 'SI',
  '724': 'ES', '752': 'SE', '756': 'CH', '792': 'TR', '804': 'UA',
  '807': 'MK', '826': 'GB',
};

const MICROSTATE_CODES= ['AD', 'MT', 'MC', 'SM'];

let _container, _svg, _gZoom, _gMap, _gArcs, _gPins, _gLegend;
let _projection, _path;
let _topoData= null;
let _featureMap= {};
let _centroidMap= {};

let _zoom= null;
let _zoomSliderEl= null;
let _currentK= 1;
const ZOOM_MIN= 0.5;
const ZOOM_MAX= 20;

export async function init(container) {
  _container= container;
  container.innerHTML= '';
  container.style.overflow= 'hidden';

  _topoData= await d3.json('data/europe.topo.json');

  const W= container.clientWidth || 620;
  const H= container.clientHeight || 420;

  _svg= d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('display', 'block');

  _gZoom= _svg.append('g').attr('class', 'zoom-layer');
  _gMap= _gZoom.append('g').attr('class', 'map-layer');
  _gArcs= _gZoom.append('g').attr('class', 'arcs-layer');
  _gPins= _gZoom.append('g').attr('class', 'pins-layer');

  const euroBounds= {
    type: 'Feature',
    geometry: {
      type: 'Polygon',
      coordinates: [[[-28, 27], [65, 27], [65, 72], [-28, 72], [-28, 27]]],
    },
  };
  _projection= d3.geoNaturalEarth1();
  _projection.fitExtent([[20, 10], [W-20, H-10]], euroBounds);
  _path= d3.geoPath().projection(_projection);

  // clip polygons to the viewport so overseas territories like french guiana
  // dont create invisible click regions that overlap european neighbours
  const defs= _svg.append('defs');
  defs.append('clipPath').attr('id', 'map-euro-clip')
    .append('rect').attr('x', 0).attr('y', 0).attr('width', W).attr('height', H);

  const countries= topojson.feature(_topoData, _topoData.objects.countries);
  _featureMap= {};
  for (const f of countries.features) {
    const code= ISO_NUM[f.id];
    if (code) _featureMap[code]= f;
  }

  // use capital coordinates instead of polygon centroids because countries
  // with overseas territories (france, etc.) have unreliable geometric centres
  for (const node of db.nodes) {
    if (node.is_pseudo || node.lon == null) continue;
    _centroidMap[node.id]= _projection([node.lon, node.lat]);
  }

  _gMap.selectAll('path.map-country')
    .data(countries.features, d => d.id)
    .join('path')
    .attr('class', 'map-country')
    .attr('d', _path)
    .attr('fill-rule', 'evenodd')
    .attr('clip-path', 'url(#map-euro-clip)')
    .on('mouseover', _onHover)
    .on('mousemove', tipMove)
    .on('mouseout', tipHide)
    .on('click', _onClick);

  _svg.on('click', (event) => {
    if (event.target === _svg.node()) update({ selectedCountry: null });
  });

  _zoom= d3.zoom()
    .scaleExtent([ZOOM_MIN, ZOOM_MAX])
    .on('zoom', (event) => {
      _currentK= event.transform.k;
      _gZoom.attr('transform', event.transform);
      _scalePins(_currentK);
      _scaleArcs(_currentK);
      _scaleBorders(_currentK);
      _syncZoomSlider(_currentK);
    });
  _svg.call(_zoom);

  _buildLegend(W, H);
  _buildMicrostatePins();
  _buildZoomSlider();

  subscribe(() => _render());
  _render();
}

function _render() {
  _renderChoropleth();
  _renderArcs();
}

// bivariate color: hue encodes region, lightness encodes avg votes received
const REGION_MAP_COLORS= {
  'Nordic': { lo: '#c8dff5', hi: '#1a4a7a' },
  'Baltic': { lo: '#c8edc8', hi: '#1a5e1a' },
  'British Isles': { lo: '#fde8c8', hi: '#8a4400' },
  'Western Europe': { lo: '#c8eded', hi: '#1a5e5a' },
  'Iberia': { lo: '#f5c8c8', hi: '#7a1010' },
  'Italic': { lo: '#f5d0da', hi: '#8a2040' },
  'Central Europe': { lo: '#e8ddd0', hi: '#4a3020' },
  'Balkans': { lo: '#e8e0d8', hi: '#504840' },
  'Eastern Europe': { lo: '#f5f0c0', hi: '#806800' },
  'Caucasus': { lo: '#ead0f0', hi: '#4a1060' },
  'Levant': { lo: '#c8ece8', hi: '#104a44' },
  'Maghreb': { lo: '#c8eae8', hi: '#2a6a65' },
  'Oceania': { lo: '#f5d0e4', hi: '#6a1040' },
};
const REGION_DEFAULT= { lo: '#e8e8e8', hi: '#666666' };

function _bivariateScale(summary) {
  const values= summary.map(s => s.avg_points_received).filter(v => v > 0);
  const maxVal= d3.max(values) || 1;
  return { maxVal };
}

function _fillForCountry(code, csMap, bivariateCtx) {
  if (!code) return '#eee';
  const s= csMap.get(code);
  if (!s) return '#ddd';

  const region= db.nodesMap[code]?.region;
  const palette= REGION_MAP_COLORS[region] || REGION_DEFAULT;
  const t= s.avg_points_received/bivariateCtx.maxVal;

  return d3.interpolateRgb(palette.lo, palette.hi)(t);
}

function _renderChoropleth() {
  const summary= getCountrySummary(state);
  const csMap= getCountrySummaryMap(state);
  const biCtx= _bivariateScale(summary);
  const sel= state.selectedCountry;

  const k= _currentK;
  _gMap.selectAll('path.map-country')
    .attr('fill', d => _fillForCountry(ISO_NUM[d.id], csMap, biCtx))
    .attr('stroke', d => (ISO_NUM[d.id] === sel ? 'var(--accent)' : '#fff'))
    .attr('stroke-width', d => (ISO_NUM[d.id] === sel ? 2 : 0.5)/k);

  _gPins.selectAll('circle.micro-pin')
    .attr('fill', d => _fillForCountry(d.code, csMap, biCtx))
    .attr('stroke', d => d.code === sel ? 'var(--accent)' : '#333')
    .attr('stroke-width', d => (d.code === sel ? 2 : 0.8)/k);
}

function _renderArcs() {
  _gArcs.selectAll('*').remove();

  const sel= state.selectedCountry;
  if (!sel) return;

  const cs= getCountrySummaryMap(state).get(sel);
  if (!cs) return;

  const src= _centroidMap[sel];
  if (!src || isNaN(src[0])) return;

  const arcs= [];

  for (const tgt of (cs.top_allies_out || []).slice(0, 5)) {
    const t= _centroidMap[tgt];
    if (!t || isNaN(t[0])) continue;
    arcs.push({ from: src, to: t, dir: 'out' });
  }

  for (const srcCode of (cs.top_allies_in || []).slice(0, 5)) {
    const s= _centroidMap[srcCode];
    if (!s || isNaN(s[0])) continue;
    arcs.push({ from: s, to: src, dir: 'in' });
  }

  const ARC_OUT= '#00897b';
  const ARC_IN= '#6a1b9a';

  _gArcs.selectAll('path.map-arc')
    .data(arcs)
    .join('path')
    .attr('class', 'map-arc')
    .attr('d', d => _arcPath(d.from, d.to, d.dir === 'out' ? 1 : -1))
    .attr('stroke', d => d.dir === 'out' ? ARC_OUT : ARC_IN)
    .attr('stroke-width', 2/_currentK)
    .attr('stroke-dasharray', d => d.dir === 'in' ? `${6/_currentK},${3/_currentK}` : null)
    .attr('stroke-opacity', 0.85);

  _gArcs.selectAll('circle.arc-dot')
    .data(arcs)
    .join('circle')
    .attr('class', 'arc-dot')
    .attr('cx', d => d.to[0])
    .attr('cy', d => d.to[1])
    .attr('r', 5.2/_currentK)
    .attr('fill', d => d.dir === 'out' ? ARC_OUT : ARC_IN)
    .attr('fill-opacity', 0.9);
}

function _scaleBorders(k) {
  const sel= state.selectedCountry;
  _gMap.selectAll('path.map-country')
    .attr('stroke-width', d => (ISO_NUM[d.id] === sel ? 2 : 0.5)/k);
  _gPins.selectAll('circle.micro-pin')
    .attr('stroke-width', d => (d.code === sel ? 2 : 0.8)/k);
}

function _scaleArcs(k) {
  _gArcs.selectAll('path.map-arc')
    .attr('stroke-width', 2/k)
    .attr('stroke-dasharray', d => d.dir === 'in' ? `${6/k},${3/k}` : null);
  _gArcs.selectAll('circle.arc-dot')
    .attr('r', 5.2/k);
}

// quadratic bezier with perpendicular offset so mutual pairs get separate lanes
function _arcPath([x1, y1], [x2, y2], side= 1) {
  const dx= x2-x1, dy= y2-y1;
  const len= Math.sqrt(dx*dx+dy*dy);
  if (len < 1) return `M${x1},${y1}`;
  const off= len*0.3*side;
  const cx= (x1+x2)/2-(dy/len)*off;
  const cy= (y1+y2)/2+(dx/len)*off;
  return `M${x1},${y1} Q${cx},${cy} ${x2},${y2}`;
}

function _onHover(event, d) {
  const code= ISO_NUM[d.id];
  if (!code) return;
  const name= db.nodesMap[code]?.name || code;
  const { recvPct, givenPct }= getCountryStats(code, state);
  const selNote= state.selectedCountry === code
    ? `<div class="tip-row"><span style="color:var(--accent)">selected</span></div>`
    : '';
  tipShow(event, `
    <div class="tip-header">${name}</div>
    <div class="tip-row"><span>Avg received</span><span>${recvPct}</span></div>
    <div class="tip-row"><span>Avg given</span><span>${givenPct}</span></div>
    ${selNote}
  `);
}

function _onClick(event, d) {
  event.stopPropagation();
  const code= ISO_NUM[d.id];
  if (!code) return;
  update({ selectedCountry: state.selectedCountry === code ? null : code });
}

function _buildMicrostatePins() {
  const data= MICROSTATE_CODES
    .map(code => ({ code, pos: _centroidMap[code] }))
    .filter(d => d.pos && !isNaN(d.pos[0]));

  const sel= _gPins.selectAll('g.micro-pin-group')
    .data(data, d => d.code)
    .join(enter => {
      const g= enter.append('g').attr('class', 'micro-pin-group');
      g.append('circle')
        .attr('class', 'micro-pin')
        .attr('r', 3.5)
        .attr('vector-effect', 'non-scaling-stroke')
        .style('cursor', 'pointer');
      g.append('text')
        .attr('class', 'micro-pin-label')
        .attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central')
        .attr('font-size', 8)
        .attr('font-weight', 700)
        .attr('fill', '#222')
        .attr('paint-order', 'stroke')
        .attr('stroke', '#fff')
        .attr('stroke-width', 2.5)
        .attr('dy', -9)
        .text(d => d.code);
      return g;
    })
    .attr('transform', d => `translate(${d.pos[0]},${d.pos[1]}) scale(1)`);

  sel.select('circle.micro-pin')
    .on('mouseover', (event, d) => {
      const name= db.nodesMap[d.code]?.name || d.code;
      const { recvPct, givenPct }= getCountryStats(d.code, state);
      tipShow(event, `
        <div class="tip-header">${name}</div>
        <div class="tip-row"><span>Avg received</span><span>${recvPct}</span></div>
        <div class="tip-row"><span>Avg given</span><span>${givenPct}</span></div>
      `);
    })
    .on('mousemove', tipMove)
    .on('mouseout', tipHide)
    .on('click', (event, d) => {
      event.stopPropagation();
      update({ selectedCountry: state.selectedCountry === d.code ? null : d.code });
    });
}

function _scalePins(k) {
  if (!_gPins) return;
  const inv= 1/k;
  _gPins.selectAll('g.micro-pin-group')
    .attr('transform', d => `translate(${d.pos[0]},${d.pos[1]}) scale(${inv})`);
}

function _buildZoomSlider() {
  _container.querySelector('.map-zoom-bar')?.remove();

  const bar= document.createElement('div');
  bar.className= 'map-zoom-bar';
  bar.innerHTML= `
    <button class="zoom-btn" type="button" data-zoom="in" title="Zoom in">+</button>
    <input  class="zoom-slider" type="range" orient="vertical"
            min="${ZOOM_MIN}" max="${ZOOM_MAX}" step="0.1" value="1"
            aria-label="Map zoom level">
    <button class="zoom-btn" type="button" data-zoom="out" title="Zoom out">-</button>
    <button class="zoom-btn zoom-reset" type="button" data-zoom="reset" title="Reset zoom">reset</button>
  `;
  _container.appendChild(bar);

  _zoomSliderEl= bar.querySelector('.zoom-slider');

  _zoomSliderEl.addEventListener('input', () => {
    const k= +_zoomSliderEl.value;
    _svg.call(_zoom.scaleTo, k);
  });

  bar.querySelector('[data-zoom=in]').addEventListener('click', () => {
    _svg.transition().duration(180).call(_zoom.scaleBy, 1.5);
  });
  bar.querySelector('[data-zoom=out]').addEventListener('click', () => {
    _svg.transition().duration(180).call(_zoom.scaleBy, 1/1.5);
  });
  bar.querySelector('[data-zoom=reset]').addEventListener('click', () => {
    _svg.transition().duration(220).call(_zoom.transform, d3.zoomIdentity);
  });
}

function _syncZoomSlider(k) {
  if (!_zoomSliderEl) return;
  _zoomSliderEl.value= k;
}

function _buildLegend(W, H) {
  const LW= 192, LH= 72;

  _gLegend= _svg.append('g')
    .attr('class', 'map-legend')
    .attr('transform', `translate(12,${H-LH-12})`);

  _gLegend.append('rect')
    .attr('width', LW).attr('height', LH)
    .attr('rx', 6)
    .attr('fill', 'white').attr('fill-opacity', 0.92)
    .attr('stroke', 'var(--border)').attr('stroke-width', 1);

  _gLegend.append('text').attr('class', 'lgnd-section').attr('x', 10).attr('y', 16)
    .text('Arc direction');

  _gLegend.append('path').attr('class', 'lgnd-arc')
    .attr('d', 'M10,27 Q22,21 34,27').attr('stroke', '#00897b');
  _gLegend.append('text').attr('class', 'lgnd-item').attr('x', 40).attr('y', 30)
    .text('Sends votes to (solid)');

  _gLegend.append('path').attr('class', 'lgnd-arc')
    .attr('d', 'M10,45 Q22,39 34,45').attr('stroke', '#6a1b9a')
    .attr('stroke-dasharray', '4,2');
  _gLegend.append('text').attr('class', 'lgnd-item').attr('x', 40).attr('y', 48)
    .text('Receives from (dashed)');

  _gLegend.append('line').attr('class', 'lgnd-sep')
    .attr('x1', 10).attr('x2', 178).attr('y1', 56).attr('y2', 56);

  _gLegend.append('rect')
    .attr('x', 10).attr('y', 60).attr('width', 10).attr('height', 10)
    .attr('rx', 2).attr('fill', '#ddd');
  _gLegend.append('text').attr('class', 'lgnd-item').attr('x', 25).attr('y', 69)
    .text('No data in range');
}
