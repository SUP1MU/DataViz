import { state, subscribe, update } from './state.js';
import { init as initData, db, getCountryStats } from './data.js';
import { init as initControls } from './controls.js';
import { init as initMatrix } from './matrix.js';
import { init as initMap } from './map.js';
import { init as initNetwork } from './network.js';
import { init as initTimeline } from './timeline.js';
import { init as initInsights, showQ1, showQ2, showQ3, hidePanel } from './insights.js';

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

    // research question shortcut buttons — each applies a curated preset
    // so the user immediately sees the answer without adjusting sliders manually
    _wireRqButtons();
    initInsights();

    document.getElementById('loading').style.display= 'none';
  } catch (err) {
    console.error('Data load failed:', err);
    const el= document.getElementById('loading');
    el.textContent= 'Error loading data. Is the server running? (python3 -m http.server 8000)';
    el.style.background= '#8b0000';
  }
}

// sync controls-strip DOM to match a state patch so sliders/selects/checkboxes
// reflect the preset visually after a Q button is clicked
function _syncControlsUi(patch) {
  if (patch.yearRange) {
    const s= document.getElementById('year-start');
    const e= document.getElementById('year-end');
    if (s) s.value= patch.yearRange[0];
    if (e) e.value= patch.yearRange[1];
  }
  if (patch.voteType) {
    const inp= document.querySelector(`input[name=voteType][value="${patch.voteType}"]`);
    if (inp) inp.checked= true;
  }
  if (patch.sortMode) {
    const sel= document.getElementById('sort-mode');
    if (sel) sel.value= patch.sortMode;
  }
  if (patch.edgeThreshold !== undefined) {
    const sl= document.getElementById('edge-threshold');
    if (sl) {
      sl.value= patch.edgeThreshold;
      const lbl= sl.closest('.slider-wrap')?.querySelector('.slider-val');
      if (lbl) lbl.textContent= (patch.edgeThreshold*100).toFixed(0)+'%';
    }
  }
  if (patch.yearsActive !== undefined) {
    const sl= document.getElementById('years-active');
    if (sl) {
      sl.value= patch.yearsActive;
      const lbl= sl.closest('.slider-wrap')?.querySelector('.slider-val');
      if (lbl) lbl.textContent= patch.yearsActive === 1 ? 'any' : patch.yearsActive+'+';
    }
  }
  if (patch.showFullHistory !== undefined) {
    const cb= document.getElementById('full-history');
    if (cb) cb.checked= patch.showFullHistory;
    // mirror the year selects lock state
    const s= document.getElementById('year-start');
    const e= document.getElementById('year-end');
    if (s) s.disabled= patch.showFullHistory;
    if (e) e.disabled= patch.showFullHistory;
    document.querySelectorAll('input[name=voteType]').forEach(i => {
      i.disabled= patch.showFullHistory;
    });
  }
}

function _wireRqButtons() {
  const btns= document.querySelectorAll('.rq');

  // Q1 — show the most persistent pairs: strong score + many years
  // cyprus-greece is the standout at 95% over 6 years
  document.getElementById('rq1')?.addEventListener('click', () => {
    const patch= {
      yearRange: [2016, 2025],
      voteType: 'total',
      sortMode: 'cluster',
      edgeThreshold: 0.65,
      yearsActive: 6,
      showFullHistory: false,
      selectedPair: null,
      selectedGroupPair: null,
      selectedCountry: null,
    };
    _syncControlsUi(patch);
    update(patch);
    _setActiveRq('rq1');
    showQ1();
  });

  // Q2 — shifting relationship: ch->gb is the clearest fall in the dataset
  // show full history so the 63-year decline is visible in the timeline
  document.getElementById('rq2')?.addEventListener('click', () => {
    const patch= {
      yearRange: [1957, 2025],
      voteType: 'total',
      sortMode: 'cluster',
      edgeThreshold: 0,
      yearsActive: 1,
      showFullHistory: true,
      selectedPair: { source: 'CH', target: 'GB' },
      selectedGroupPair: null,
      selectedCountry: null,
    };
    _syncControlsUi(patch);
    update(patch);
    _setActiveRq('rq2');
    showQ2();
  });

  // Q3 — jury vs public: set jury mode so the user can toggle to televote
  // and immediately see which cells change
  document.getElementById('rq3')?.addEventListener('click', () => {
    const patch= {
      yearRange: [2016, 2025],
      voteType: 'jury',
      sortMode: 'cluster',
      edgeThreshold: 0,
      yearsActive: 1,
      showFullHistory: false,
      selectedPair: null,
      selectedGroupPair: null,
      selectedCountry: null,
    };
    _syncControlsUi(patch);
    update(patch);
    _setActiveRq('rq3');
    showQ3();
  });

  // clear active highlight when user manually changes anything
  document.getElementById('controls-strip')?.addEventListener('change', () => { _setActiveRq(null); hidePanel(); });
  document.getElementById('controls-strip')?.addEventListener('input', () => { _setActiveRq(null); hidePanel(); });
}

function _setActiveRq(id) {
  document.querySelectorAll('.rq').forEach(b => b.classList.toggle('rq-active', b.id === id));
}

main();
