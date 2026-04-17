// popup.js — PagePulse popup controller

// ── State ────────────────────────────────────────────────────
let currentData = null;
let currentAnalysis = null;
let activeTab = 'issues';

// Timeline phase colors
const TIMELINE_COLORS = {
  dnsTime:      '#8b5cf6',
  tcpTime:      '#3b82f6',
  tlsTime:      '#06b6d4',
  ttfb:         '#f59e0b',
  downloadTime: '#22c55e',
  domParseTime: '#f97316',
  renderTime:   '#ec4899',
};

const TIMELINE_LABELS = {
  dnsTime:      'DNS',
  tcpTime:      'TCP',
  tlsTime:      'TLS',
  ttfb:         'TTFB',
  downloadTime: 'Download',
  domParseTime: 'DOM',
  renderTime:   'Render',
};

// ── Init ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupButtons();
  loadData();
});

// ── Tab switching ────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      switchTab(tab);
    });
  });
}

function switchTab(tab) {
  activeTab = tab;

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('.tab-panel').forEach(panel => {
    panel.classList.add('hidden');
    panel.classList.remove('active');
  });

  const activePanel = document.getElementById(`tab-${tab}`);
  if (activePanel) {
    activePanel.classList.remove('hidden');
    activePanel.classList.add('active');
  }

  // Trigger bar animations when switching to breakdown tab
  if (tab === 'breakdown' && currentData) {
    setTimeout(() => animateBars(), 50);
  }
}

// ── Button handlers ──────────────────────────────────────────
function setupButtons() {
  document.getElementById('btn-refresh').addEventListener('click', () => {
    showLoading();
    refreshCurrentTab();
  });

  document.getElementById('nodata-refresh').addEventListener('click', () => {
    showLoading();
    refreshCurrentTab();
  });

  document.getElementById('btn-export').addEventListener('click', exportReport);
}

// ── Data loading ─────────────────────────────────────────────
async function loadData() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showNoData();
      return;
    }

    const tabId = tab.id;
    const storageKey = `timing_${tabId}`;

    const result = await chrome.storage.local.get([storageKey]);
    const data = result[storageKey];

    if (!data) {
      // Try requesting fresh data from content script
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_TIMING' });
        // Wait a moment for data to be stored
        setTimeout(() => loadData(), 800);
      } catch (e) {
        showNoData();
      }
      return;
    }

    // Check if data is stale (older than 5 minutes)
    const age = Date.now() - data.timestamp;
    if (age > 5 * 60 * 1000) {
      try {
        await chrome.tabs.sendMessage(tabId, { type: 'COLLECT_TIMING' });
        setTimeout(() => loadData(), 800);
      } catch (e) {
        // Use old data if we can't refresh
        renderData(data);
      }
      return;
    }

    renderData(data);
  } catch (e) {
    showNoData();
  }
}

async function refreshCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) { showNoData(); return; }

    const tabId = tab.id;
    const storageKey = `timing_${tabId}`;

    // Clear old data
    await chrome.storage.local.remove([storageKey]);

    // Ask content script to re-collect
    chrome.tabs.sendMessage(tabId, { type: 'COLLECT_TIMING' }, () => {
      setTimeout(() => loadData(), 600);
    });
  } catch (e) {
    showNoData();
  }
}

// ── Render ───────────────────────────────────────────────────
function renderData(data) {
  currentData = data;
  currentAnalysis = analyzeData(data);

  showMain();

  // Header
  document.getElementById('site-hostname').textContent = data.pageUrl || 'Unknown';
  document.getElementById('total-load-display').textContent = currentAnalysis.totalLoadFormatted;

  // Protocol badge in header
  const protoBadge = document.getElementById('site-protocol');
  protoBadge.textContent = currentAnalysis.protocol.label;
  protoBadge.className = `protocol-badge ${currentAnalysis.protocol.color === 'good' ? '' : currentAnalysis.protocol.color}`;

  // Timestamp
  const ageSeconds = Math.round((Date.now() - data.timestamp) / 1000);
  const ageText = ageSeconds < 5 ? 'just now' :
                  ageSeconds < 60 ? `${ageSeconds}s ago` :
                  `${Math.round(ageSeconds / 60)}m ago`;
  document.getElementById('timestamp-display').textContent = `Analysed ${ageText}`;

  // Score ring
  renderScoreRing(currentAnalysis.score);

  // Cached banner
  if (data.isCached) {
    const existing = document.getElementById('cached-banner');
    if (!existing) {
      const banner = document.createElement('div');
      banner.id = 'cached-banner';
      banner.className = 'cached-banner';
      banner.textContent = '⚡ Served from cache — some metrics may be 0';
      document.querySelector('.tab-nav').insertAdjacentElement('beforebegin', banner);
    }
  }

  // Render all tab content
  renderIssuesTab();
  renderBreakdownTab();
  renderNetworkTab();

  // Switch to issues tab by default
  switchTab(activeTab);
}

function renderScoreRing(score) {
  const arc = document.getElementById('score-arc');
  const numEl = document.getElementById('score-number');

  const circumference = 201.06; // 2π × r(32)
  const offset = circumference - (score / 100) * circumference;

  numEl.textContent = score;

  // Color based on score
  let color = 'var(--score-bad)';
  if (score >= 80) color = 'var(--score-good)';
  else if (score >= 50) color = 'var(--score-warn)';

  arc.style.stroke = color;

  // Animate
  setTimeout(() => {
    arc.style.strokeDashoffset = offset;
  }, 100);
}

// ── Issues Tab ───────────────────────────────────────────────
function renderIssuesTab() {
  const container = document.getElementById('issues-list');
  const conceptsSection = document.getElementById('cn-concepts');
  const conceptsTags = document.getElementById('concepts-tags');
  const issues = currentAnalysis.issues;

  container.innerHTML = '';
  conceptsTags.innerHTML = '';

  if (issues.length === 0) {
    container.innerHTML = `
      <div class="all-good">
        <div class="all-good-icon">✅</div>
        <div class="all-good-title">All good! Page loaded fast.</div>
        <div class="all-good-sub">No performance issues detected. Score: ${currentAnalysis.score}/100</div>
      </div>
    `;
    conceptsSection.classList.add('hidden');
    return;
  }

  // Build issue cards
  const allConcepts = new Set();
  issues.forEach(issue => {
    const card = document.createElement('div');
    card.className = `issue-card ${issue.severity}`;
    card.innerHTML = `
      <div class="issue-header">
        <span class="severity-badge ${issue.severity}">${issue.severity}</span>
        <span class="issue-label">${escapeHtml(issue.label)}</span>
      </div>
      <p class="issue-desc">${escapeHtml(issue.desc)}</p>
      <p class="issue-fix">${escapeHtml(issue.fix)}</p>
      <p class="issue-concept">${escapeHtml(issue.cnConcept)}</p>
    `;
    container.appendChild(card);

    // Collect unique concepts
    issue.cnConcept.split(',').forEach(c => allConcepts.add(c.trim()));
  });

  // CN Concepts pills
  if (allConcepts.size > 0) {
    allConcepts.forEach(concept => {
      const pill = document.createElement('span');
      pill.className = 'concept-tag';
      pill.textContent = concept;
      conceptsTags.appendChild(pill);
    });
    conceptsSection.classList.remove('hidden');
  } else {
    conceptsSection.classList.add('hidden');
  }
}

// ── Breakdown Tab ────────────────────────────────────────────
function renderBreakdownTab() {
  const chart = document.getElementById('metrics-chart');
  const tlValue = document.getElementById('tl-value');
  chart.innerHTML = '';

  const metrics = currentAnalysis.metrics;
  const maxValue = Math.max(...Object.values(metrics).map(m => m.value), 1);

  Object.entries(metrics).forEach(([key, metric]) => {
    if (key === 'totalLoadTime') return; // Shown separately

    const barPct = Math.min(100, (metric.value / maxValue) * 100);
    const isNA = key === 'tlsTime' && !currentData.isHttps;
    const displayValue = isNA ? 'N/A' : `${metric.value}ms`;

    const row = document.createElement('div');
    row.className = 'metric-row';
    row.innerHTML = `
      <span class="metric-name">${metric.label}</span>
      <div class="bar-track">
        <div class="bar-fill ${isNA ? 'good' : metric.status}" 
             data-pct="${isNA ? 0 : barPct}"
             style="width: 0%"></div>
      </div>
      <span class="metric-value">${displayValue}</span>
      <span class="status-pill ${isNA ? 'good' : metric.status}">${isNA ? 'N/A' : metric.status}</span>
    `;
    chart.appendChild(row);
  });

  tlValue.textContent = currentAnalysis.totalLoadFormatted;
}

function animateBars() {
  document.querySelectorAll('.bar-fill').forEach(bar => {
    const pct = bar.dataset.pct || 0;
    bar.style.width = `${pct}%`;
  });
}

// ── Network Tab ──────────────────────────────────────────────
function renderNetworkTab() {
  // Protocol
  const netProto = document.getElementById('net-protocol');
  netProto.textContent = currentAnalysis.protocol.label;

  // Size
  document.getElementById('net-size').textContent = currentAnalysis.transferSizeFormatted;

  // Resources
  document.getElementById('net-resources').textContent = `${currentData.resourceCount} files`;

  // Timeline
  renderTimeline();
}

function renderTimeline() {
  const timeline = document.getElementById('network-timeline');
  const legend = document.getElementById('timeline-legend');
  timeline.innerHTML = '';
  legend.innerHTML = '';

  const phases = ['dnsTime', 'tcpTime', 'tlsTime', 'ttfb', 'downloadTime', 'domParseTime', 'renderTime'];
  const values = phases.map(p => {
    // Skip TLS if not HTTPS
    if (p === 'tlsTime' && !currentData.isHttps) return 0;
    return currentData[p] || 0;
  });

  const total = values.reduce((a, b) => a + b, 0) || 1;

  phases.forEach((phase, i) => {
    const val = values[i];
    if (val <= 0) return;

    const pct = (val / total) * 100;
    const color = TIMELINE_COLORS[phase];

    // Timeline segment
    const seg = document.createElement('div');
    seg.className = 'timeline-segment';
    seg.style.width = `${pct}%`;
    seg.style.background = color;
    seg.title = `${TIMELINE_LABELS[phase]}: ${val}ms`;
    timeline.appendChild(seg);

    // Legend item
    const item = document.createElement('div');
    item.className = 'legend-item';
    item.innerHTML = `
      <div class="legend-dot" style="background: ${color}"></div>
      <span>${TIMELINE_LABELS[phase]} (${val}ms)</span>
    `;
    legend.appendChild(item);
  });
}

// ── Export ───────────────────────────────────────────────────
function exportReport() {
  if (!currentData || !currentAnalysis) return;

  const d = currentData;
  const a = currentAnalysis;
  const date = new Date(d.timestamp).toLocaleString();

  let report = `
╔══════════════════════════════════════════════════════════╗
║              PagePulse — Network Diagnostic Report        ║
╚══════════════════════════════════════════════════════════╝

Site:       ${d.pageUrl}
Analysed:   ${date}
Score:      ${a.score}/100
Total Load: ${a.totalLoadFormatted}
Protocol:   ${a.protocol.label}
Page Size:  ${a.transferSizeFormatted}
Resources:  ${d.resourceCount} requests

──────────────────────────────────────────────────────────
PERFORMANCE METRICS
──────────────────────────────────────────────────────────
DNS Lookup:      ${d.dnsTime}ms      [${a.metrics.dnsTime.status.toUpperCase()}]
TCP Connect:     ${d.tcpTime}ms      [${a.metrics.tcpTime.status.toUpperCase()}]
TLS Handshake:   ${d.isHttps ? d.tlsTime + 'ms' : 'N/A (HTTP)'}    [${d.isHttps ? a.metrics.tlsTime.status.toUpperCase() : 'N/A'}]
Server Response: ${d.ttfb}ms      [${a.metrics.ttfb.status.toUpperCase()}]
Download:        ${d.downloadTime}ms      [${a.metrics.downloadTime.status.toUpperCase()}]
DOM Parsing:     ${d.domParseTime}ms      [${a.metrics.domParseTime.status.toUpperCase()}]
Rendering:       ${d.renderTime}ms      [${a.metrics.renderTime.status.toUpperCase()}]

──────────────────────────────────────────────────────────
DETECTED ISSUES (${a.issues.length})
──────────────────────────────────────────────────────────
`;

  if (a.issues.length === 0) {
    report += '✅ No issues detected. Page loaded fast.\n';
  } else {
    a.issues.forEach((issue, i) => {
      report += `
[${i + 1}] [${issue.severity.toUpperCase()}] ${issue.label}
    ${issue.desc}
    Fix: ${issue.fix}
    CN Concept: ${issue.cnConcept}
`;
    });
  }

  report += `
──────────────────────────────────────────────────────────
Generated by PagePulse — A Computer Networks Project
──────────────────────────────────────────────────────────
`;

  const blob = new Blob([report.trim()], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a2 = document.createElement('a');
  a2.href = url;
  a2.download = `pagepulse-${d.pageUrl}-${Date.now()}.txt`;
  a2.click();
  URL.revokeObjectURL(url);
}

// ── UI State helpers ─────────────────────────────────────────
function showLoading() {
  document.getElementById('loading-state').classList.remove('hidden');
  document.getElementById('nodata-state').classList.add('hidden');
  document.getElementById('main-content').classList.add('hidden');
}

function showNoData() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('nodata-state').classList.remove('hidden');
  document.getElementById('main-content').classList.add('hidden');
}

function showMain() {
  document.getElementById('loading-state').classList.add('hidden');
  document.getElementById('nodata-state').classList.add('hidden');
  document.getElementById('main-content').classList.remove('hidden');
}

// ── Utils ────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
