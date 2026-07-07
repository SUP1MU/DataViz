/* global d3 */

export function render(containerEl, colorScale, label) {
  d3.select(containerEl).selectAll('*').remove();

  const W= 180, H= 14;
  const pad= { l: 4, r: 4, t: 20, b: 22 };
  const STEPS= 40;

  const svg= d3.select(containerEl).append('svg')
    .attr('width', W+pad.l+pad.r)
    .attr('height', H+pad.t+pad.b);

  const defs= svg.append('defs');
  const gradId= 'lgnd-grad';
  const grad= defs.append('linearGradient').attr('id', gradId);
  d3.range(STEPS+1).forEach(i => {
    grad.append('stop')
      .attr('offset', `${((i/STEPS)*100).toFixed(0)}%`)
      .attr('stop-color', colorScale(i/STEPS));
  });

  const g= svg.append('g').attr('transform', `translate(${pad.l},${pad.t})`);

  g.append('rect')
    .attr('width', W).attr('height', H)
    .attr('rx', 2)
    .attr('fill', `url(#${gradId})`);

  const axSc= d3.scaleLinear().domain(colorScale.domain()).range([0, W]);
  g.append('g')
    .attr('transform', `translate(0,${H})`)
    .call(d3.axisBottom(axSc).ticks(4).tickFormat(d3.format('.0%')))
    .select('.domain').remove();

  svg.append('text')
    .attr('x', pad.l)
    .attr('y', pad.t-6)
    .attr('font-size', 11)
    .attr('fill', '#555')
    .text(label);
}
