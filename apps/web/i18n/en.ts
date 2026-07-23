/**
 * UI copy lives here, not inline in components (§3: "i18n English + Bangla
 * from day one — copy in a dictionary, not hardcoded"). Phase 2 ships
 * English only; the dictionary shape is what Phase 7 populates a `bn.ts`
 * twin of and wires into real locale routing — this file is that seam,
 * not the full routing infrastructure.
 */
export const dictionary = {
  test: {
    heading: 'NetVerdict',
    tagline: "Don't guess. Get the verdict on your connection.",
    startButton: 'Start test',
    stopButton: 'Stop',
    runAnotherButton: 'Run another test',
    abortedMessage: 'Test stopped.',
    phase: {
      idle: 'Ready when you are',
      idle_latency: 'Measuring idle latency',
      download: 'Measuring download speed',
      upload: 'Measuring upload speed',
      // Not emitted until Phase 3 wires up bufferbloat probing — kept here so
      // this lookup stays exhaustive against the full MeasurementPhase union.
      loaded_latency_down: 'Measuring loaded latency (download)',
      loaded_latency_up: 'Measuring loaded latency (upload)',
      done: 'Done',
    },
    liveMetric: {
      download: 'Download',
      upload: 'Upload',
    },
    advancedMetrics: {
      heading: 'Advanced metrics',
      idleLatency: 'Idle latency',
      jitter: 'Jitter',
      packetLoss: 'Packet loss',
      streams: 'streams',
      server: 'Test server',
      serverExplainer:
        'Measured against Cloudflare’s nearest edge, not a server inside your ISP’s own network. Tools that use an in-network server measure a shorter path and usually report a higher number; this one reflects what your connection does reaching the wider internet.',
      underLoadHeading: 'While your connection is busy',
      loadedLatencyDown: 'Latency (downloading)',
      loadedLatencyUp: 'Latency (uploading)',
      bufferbloatDown: 'Bufferbloat (down)',
      bufferbloatUp: 'Bufferbloat (up)',
      rpm: 'RPM',
      rpmExplainer: 'Higher = your connection stays responsive when busy.',
    },
    error: {
      heading: 'That didn’t work',
      networkUnavailable: 'Your connection dropped mid-test. Check your network and try again.',
      endpointRejected: 'The measurement server rejected the request. Try again in a moment.',
      endpointRateLimited:
        'The measurement server is limiting how often you can test. Wait a minute and try again — this says nothing about your connection.',
      corsBlocked:
        'A network policy blocked the test. If you’re on a work or school network, this may be a firewall.',
      timeout: 'The test took too long to respond and timed out.',
      insufficientSamples: 'The connection was too unstable to get a reliable reading.',
      unsupportedEnvironment:
        'This browser doesn’t support the streaming APIs this test needs. Try an up-to-date Chrome, Firefox, Edge, or Safari.',
      unknown: 'Something went wrong measuring that phase.',
      retry: 'Try again',
    },
  },
  result: {
    heading: 'Your result',
    partialNotice:
      'This result is partial — at least one phase didn’t complete. Numbers shown are still real, nothing here was estimated.',
    anomalyNotice: 'This result is far outside your usual range and is flagged, not hidden.',
    saveToHistory: 'Save to history',
    saveToHistoryHint: 'Sign in to keep a history — coming in a later build phase.',
    shareAsEvidence: 'Share as evidence',
    shareAsEvidenceHint: 'Evidence reports land in a later build phase.',
    unavailable: 'unavailable',
  },
  realWorldTranslation: {
    heading: 'What this supports right now',
    streaming4k: '4K streaming',
    streamingHd: 'HD streaming',
    videoCalls: 'Group video calls',
    gaming: 'Competitive gaming',
    gamingUnavailableReason: 'needs bufferbloat data — a later build phase',
  },
} as const;

export type Dictionary = typeof dictionary;
