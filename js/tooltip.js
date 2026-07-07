/* global d3 */

let _tip= null;

function _ensure() {
  if (!_tip) {
    _tip= d3.select('body').append('div')
      .attr('id', 'tooltip')
      .style('position', 'fixed')
      .style('pointer-events', 'none')
      .style('display', 'none');
  }
  return _tip;
}

export function show(event, html) {
  const tip= _ensure();
  tip.html(html).style('display', 'block');
  move(event);
}

export function move(event) {
  const tip= _ensure();
  const W= window.innerWidth;
  const H= window.innerHeight;
  const tw= tip.node().offsetWidth+20;
  const th= tip.node().offsetHeight+20;
  let x= event.clientX+14;
  let y= event.clientY+14;
  if (x+tw > W) x= event.clientX-tw;
  if (y+th > H) y= event.clientY-th;
  tip.style('left', x+'px').style('top', y+'px');
}

export function hide() {
  _ensure().style('display', 'none');
}

export function pairHtml(srcName, tgtName, pair) {
  const spark= _sparkline(pair.yearly);
  return `
    <div class="tip-header">${srcName} to ${tgtName}</div>
    <div class="tip-row"><span>Mean points</span><span>${pair.mean_points}</span></div>
    <div class="tip-row"><span>Mean support</span><span>${(pair.mean_normalized*100).toFixed(1)}%</span></div>
    <div class="tip-row"><span>Years active</span><span>${pair.years_active}</span></div>
    <div class="tip-spark">${spark}</div>`;
}

function _sparkline(yearly) {
  if (!yearly || yearly.length === 0) return '';
  const W= 120, H= 36, pad= 4;
  const years= yearly.map(y => y.year);
  const vals= yearly.map(y => y.normalized);
  const xSc= d3.scaleLinear().domain(d3.extent(years)).range([pad, W-pad]);
  const ySc= d3.scaleLinear().domain([0, 1]).range([H-pad, pad]);
  const line= d3.line()
    .x((_, i) => xSc(years[i]))
    .y(v => ySc(v))
    .curve(d3.curveMonotoneX);
  const pathD= line(vals);
  const dots= yearly.map(y =>
    `<circle cx="${xSc(y.year).toFixed(1)}" cy="${ySc(y.normalized).toFixed(1)}" r="2.5" fill="#1d70b8" opacity="0.85"/>`
  ).join('');
  return `<svg width="${W}" height="${H}" style="overflow:visible">
    <line x1="${pad}" y1="${H-pad}" x2="${W-pad}" y2="${H-pad}" stroke="#ccc" stroke-width="0.5"/>
    <path d="${pathD}" fill="none" stroke="#1d70b8" stroke-width="1.5"/>
    ${dots}
  </svg>`;
}
