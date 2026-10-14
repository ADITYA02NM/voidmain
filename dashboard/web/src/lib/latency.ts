// Rolling latency window: bus->screen = paintMs - (serverTs + clockOffset).

export class LatencyWindow {
  private samples: number[] = [];
  private readonly cap: number;
  last = 0;

  constructor(cap = 100) { this.cap = cap; }

  add(ms: number): void {
    this.last = ms;
    this.samples.push(ms);
    if (this.samples.length > this.cap) this.samples.shift();
  }

  private pct(p: number): number {
    if (!this.samples.length) return 0;
    const s = [...this.samples].sort((a, b) => a - b);
    const i = Math.min(s.length - 1, Math.floor((p / 100) * s.length));
    return s[i] ?? 0;
  }

  p50(): number { return this.pct(50); }
  p95(): number { return this.pct(95); }
  p99(): number { return this.pct(99); }
  count(): number { return this.samples.length; }
  recent(n = 20): number[] { return this.samples.slice(-n); }
}

// Median-of-samples clock offset estimator (server_ms - client_ms adjusted).
export class ClockSync {
  private offsets: number[] = [];
  private rtts: number[] = [];

  addPong(clientSentMs: number, serverMs: number, nowMs: number): void {
    const rtt = nowMs - clientSentMs;
    const offset = serverMs - (clientSentMs + rtt / 2);
    this.offsets.push(offset); this.rtts.push(rtt);
    if (this.offsets.length > 20) { this.offsets.shift(); this.rtts.shift(); }
  }

  offsetMs(): number {
    if (!this.offsets.length) return 0;
    const s = [...this.offsets].sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] ?? 0;
  }

  // Uncertainty ~ half the min RTT seen (best-case one-way jitter bound).
  uncertaintyMs(): number {
    if (!this.rtts.length) return Infinity;
    return Math.min(...this.rtts) / 2;
  }

  ready(): boolean { return this.offsets.length > 0; }
}
