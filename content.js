// content.js — Collects performance timing data from the page

function collectTimingData() {
  const timing = window.performance.timing;
  const navEntries = performance.getEntriesByType('navigation');
  const navEntry = navEntries.length > 0 ? navEntries[0] : null;
  const resources = performance.getEntriesByType('resource');

  // Helper to ensure non-negative values
  const safe = (val) => (val && val > 0 ? Math.round(val) : 0);

  // Core timing metrics
  const dnsTime = safe(timing.domainLookupEnd - timing.domainLookupStart);
  const tcpTime = safe(timing.connectEnd - timing.connectStart);
  
  // TLS time: only valid if secureConnectionStart > 0 (HTTPS)
  let tlsTime = 0;
  if (timing.secureConnectionStart > 0) {
    tlsTime = safe(timing.connectEnd - timing.secureConnectionStart);
  }
  
  const ttfb = safe(timing.responseStart - timing.requestStart);
  const downloadTime = safe(timing.responseEnd - timing.responseStart);
  const domParseTime = safe(timing.domInteractive - timing.responseEnd);
  const renderTime = safe(timing.domContentLoadedEventEnd - timing.domInteractive);
  const totalLoadTime = safe(timing.loadEventEnd - timing.navigationStart);

  // Navigation entry data
  let transferSize = 0;
  let protocol = 'unknown';
  if (navEntry) {
    transferSize = navEntry.transferSize || 0;
    protocol = navEntry.nextHopProtocol || 'unknown';
  }

  const resourceCount = resources.length;
  const pageUrl = window.location.hostname;
  const timestamp = Date.now();

  // Detect if page was served from cache
  const isCached = transferSize === 0 && totalLoadTime > 0;

  const data = {
    dnsTime,
    tcpTime,
    tlsTime,
    ttfb,
    downloadTime,
    domParseTime,
    renderTime,
    totalLoadTime,
    transferSize,
    protocol,
    resourceCount,
    pageUrl,
    timestamp,
    isCached,
    isHttps: timing.secureConnectionStart > 0
  };

  return data;
}

function sendTimingData() {
  try {
    const data = collectTimingData();
    
    // Only send if we have meaningful data
    if (data.totalLoadTime > 0) {
      chrome.runtime.sendMessage({
        type: 'TIMING_DATA',
        data: data
      }, (response) => {
        if (chrome.runtime.lastError) {
          // Silently handle error
        }
      });
    } else {
      // Retry after a short delay if timing isn't ready
      setTimeout(sendTimingData, 500);
    }
  } catch (e) {
    // Silently handle errors (e.g., extension context invalidated)
  }
}

// Wait for full page load before collecting
if (document.readyState === 'complete') {
  // Already loaded — collect with a small delay to ensure timing is populated
  setTimeout(sendTimingData, 100);
} else {
  window.addEventListener('load', () => {
    setTimeout(sendTimingData, 100);
  });
}

// Also listen for messages to re-collect on demand
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'COLLECT_TIMING') {
    if (document.readyState === 'complete') {
      setTimeout(() => {
        sendTimingData();
        sendResponse({ status: 'collecting' });
      }, 100);
    } else {
      sendResponse({ status: 'not_ready' });
    }
    return true;
  }
});
