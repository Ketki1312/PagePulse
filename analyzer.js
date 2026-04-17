// analyzer.js — Performance analysis engine for PagePulse

const BENCHMARKS = {
  dnsTime:      { good: 30,  warn: 100, unit: "ms", label: "DNS Lookup" },
  tcpTime:      { good: 50,  warn: 150, unit: "ms", label: "TCP Connect" },
  tlsTime:      { good: 80,  warn: 200, unit: "ms", label: "TLS Handshake" },
  ttfb:         { good: 200, warn: 500, unit: "ms", label: "Server Response" },
  downloadTime: { good: 100, warn: 300, unit: "ms", label: "Download" },
  domParseTime: { good: 200, warn: 600, unit: "ms", label: "DOM Parsing" },
  renderTime:   { good: 100, warn: 300, unit: "ms", label: "Rendering" },
  totalLoadTime:{ good: 1000, warn: 3000, unit: "ms", label: "Total Load" },
};

function getStatus(key, value) {
  const bench = BENCHMARKS[key];
  if (!bench) return 'good';
  if (value <= bench.good) return 'good';
  if (value <= bench.warn) return 'warn';
  return 'slow';
}

function calculateScore(data) {
  const weights = {
    dnsTime:      0.15,
    ttfb:         0.30,
    totalLoadTime: 0.30,
    domParseTime: 0.15,
    renderTime:   0.10
  };

  let totalScore = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = data[key] || 0;
    const bench = BENCHMARKS[key];
    const metricScore = Math.max(0, 100 - (value / bench.warn) * 100);
    totalScore += metricScore * weight;
  }

  return Math.round(totalScore);
}

function generateIssues(data) {
  const issues = [];

  // 1. Slow DNS
  if (data.dnsTime > 100) {
    issues.push({
      id: 'slow_dns',
      severity: 'warning',
      label: 'DNS server is slow',
      desc: `Your DNS lookup took ${data.dnsTime}ms. Average is under 30ms.`,
      fix: 'Switch to Cloudflare DNS (1.1.1.1) or Google DNS (8.8.8.8) in your network settings.',
      cnConcept: 'DNS — Domain Name System (Application Layer)'
    });
  }

  // 2. High TTFB
  if (data.ttfb > 500) {
    issues.push({
      id: 'slow_ttfb',
      severity: 'critical',
      label: 'Server is responding slowly',
      desc: `Server took ${data.ttfb}ms to send first byte. Under 200ms is ideal.`,
      fix: 'Server may be overloaded or physically far from you. Check if a CDN like Cloudflare is being used.',
      cnConcept: 'HTTP Request-Response, TCP Data Transfer'
    });
  }

  // 3. Slow TLS
  if (data.isHttps && data.tlsTime > 200) {
    issues.push({
      id: 'slow_tls',
      severity: 'warning',
      label: 'SSL/TLS handshake is slow',
      desc: `Encryption setup took ${data.tlsTime}ms.`,
      fix: 'Server should enable TLS 1.3 and session resumption to cut handshake time.',
      cnConcept: 'TLS Handshake, Public Key Cryptography'
    });
  }

  // 4. Slow TCP
  if (data.tcpTime > 150) {
    issues.push({
      id: 'slow_tcp',
      severity: 'warning',
      label: 'Network connection is slow',
      desc: `TCP connection took ${data.tcpTime}ms — server may be far away.`,
      fix: 'Use a CDN to serve content from a geographically closer server.',
      cnConcept: 'TCP 3-Way Handshake, Network Latency'
    });
  }

  // 5. Old HTTP protocol
  if (data.protocol === 'http/1.1') {
    issues.push({
      id: 'old_http',
      severity: 'warning',
      label: 'Using outdated HTTP/1.1',
      desc: 'This site uses HTTP/1.1. HTTP/2 loads pages 2–3× faster via multiplexing.',
      fix: 'If this is your site: enable HTTP/2 on your web server (nginx, Apache, Caddy).',
      cnConcept: 'Application Layer Protocols, HTTP Evolution'
    });
  }

  // 6. Heavy page
  if (data.transferSize > 3 * 1024 * 1024) {
    const sizeMB = (data.transferSize / (1024 * 1024)).toFixed(1);
    issues.push({
      id: 'heavy_page',
      severity: 'critical',
      label: `Page is too heavy (${sizeMB}MB)`,
      desc: `Page downloaded ${sizeMB}MB of data. Under 1MB is ideal for fast loading.`,
      fix: 'Compress images (use WebP), minify CSS/JS files, and enable gzip/Brotli on the server.',
      cnConcept: 'Bandwidth, Data Compression, Throughput'
    });
  }

  // 7. Too many resources
  if (data.resourceCount > 80) {
    issues.push({
      id: 'too_many_resources',
      severity: 'info',
      label: `${data.resourceCount} network requests made`,
      desc: `Each request requires its own DNS + TCP + TLS setup, adding overhead.`,
      fix: 'Bundle JS/CSS files together. Lazy load images below the fold.',
      cnConcept: 'HTTP Requests, Connection Overhead'
    });
  }

  // Sort: critical → warning → info
  const order = { critical: 0, warning: 1, info: 2 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);

  return issues;
}

function getProtocolBadge(protocol) {
  if (!protocol || protocol === 'unknown') return { label: 'Unknown', color: 'info' };
  if (protocol === 'h3' || protocol === 'h3-29') return { label: 'HTTP/3', color: 'good' };
  if (protocol === 'h2') return { label: 'HTTP/2', color: 'good' };
  if (protocol === 'http/1.1') return { label: 'HTTP/1.1', color: 'warn' };
  if (protocol === 'http/1.0') return { label: 'HTTP/1.0', color: 'slow' };
  return { label: protocol.toUpperCase(), color: 'info' };
}

function formatSize(bytes) {
  if (bytes === 0) return 'Cached';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTime(ms) {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${ms}ms`;
}

function analyzeData(data) {
  const score = calculateScore(data);
  const issues = generateIssues(data);
  
  const metrics = {};
  for (const key of Object.keys(BENCHMARKS)) {
    const value = data[key] || 0;
    metrics[key] = {
      value,
      status: getStatus(key, value),
      label: BENCHMARKS[key].label,
      bench: BENCHMARKS[key]
    };
  }

  return {
    score,
    issues,
    metrics,
    protocol: getProtocolBadge(data.protocol),
    transferSizeFormatted: formatSize(data.transferSize),
    totalLoadFormatted: formatTime(data.totalLoadTime),
    isCached: data.isCached,
    isHttps: data.isHttps
  };
}
