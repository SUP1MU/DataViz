import { state, subscribe } from './state.js';
import { init as initData, db, getCountryStats } from './data.js';
import { init as initControls } from './controls.js';
import { init as initMatrix } from './matrix.js';
import { init as initMap } from './map.js';
import { init as initNetwork } from './network.js';
import { init as initTimeline } from './timeline.js';

async function main() {
  try {
    await initData();

    const meta= db.meta;
    console.log(
      `loaded ${db.nodes.length} countries, ${meta.raw_edge_count} edges, `+
      `year range ${state.yearRange[0]}-${state.yearRange[1]}, `+
      `jury/public available from ${meta.split_available_years[0]}`
    );

    initControls();
    initMatrix(
      document.getElementById('matrix'),
      document.getElementById('legend'),
    );
    await initMap(document.getElementById('map'));
    initNetwork(document.getElementById('network'));
    initTimeline(document.getElementById('timeline'));

    let _lastDetailsKey= '';
    subscribe(st => {
      const infoEl= document.getElementById('selection-info');
      if (!infoEl) return;

      const detailsKey= st.selectedCountry
        ? `c:${st.selectedCountry}`
        : st.selectedPair
          ? `p:${st.selectedPair.source}:${st.selectedPair.target}`
          : '';
      if (detailsKey === _lastDetailsKey) return;
      _lastDetailsKey= detailsKey;

      if (st.selectedCountry) {
        const code= st.selectedCountry;
        const node= db.nodesMap[code];
        const name= node?.name || code;
        const { cs, recvPct, givenPct }= getCountryStats(code, st);

        const alliesOut= (cs?.top_allies_out || [])
          .map(c => db.nodesMap[c]?.name || c).join(', ') || 'none';
        const alliesIn= (cs?.top_allies_in || [])
          .map(c => db.nodesMap[c]?.name || c).join(', ') || 'none';

        infoEl.innerHTML=
          `<strong>${name}</strong><br>`+
          `<span class="tip-label">${code} · ${node?.region || ''}</span><br><br>`+
          `<span class="tip-label">Avg received</span> ${recvPct}<br>`+
          `<span class="tip-label">Avg given</span> ${givenPct}<br><br>`+
          `<span style="display:inline-block;width:20px;height:3px;background:#00897b;vertical-align:middle;margin-right:5px;border-radius:2px"></span>`+
          `<span class="tip-label">Sends votes to</span><br>${alliesOut}<br><br>`+
          `<span style="display:inline-block;width:20px;height:0;border-top:3px dashed #6a1b9a;vertical-align:middle;margin-right:5px"></span>`+
          `<span class="tip-label">Receives from</span><br>${alliesIn}<br><br>`+
          `<span class="tip-label">Click again or click empty space to deselect.</span>`;

      } else if (st.selectedPair) {
        const { source, target }= st.selectedPair;
        const sn= db.nodesMap[source]?.name || source;
        const tn= db.nodesMap[target]?.name || target;
        infoEl.innerHTML=
          `<strong>${sn} to ${tn}</strong><br>`+
          `<span class="tip-label">Click another cell to change selection.</span>`;

      } else {
        infoEl.textContent= 'Click a matrix cell or map country to explore.';
      }
    });

    document.getElementById('loading').style.display= 'none';
  } catch (err) {
    console.error('Data load failed:', err);
    const el= document.getElementById('loading');
    el.textContent= 'Error loading data. Is the server running? (python3 -m http.server 8000)';
    el.style.background= '#8b0000';
  }
}

main();
