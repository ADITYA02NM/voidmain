import type { Envelope } from "../contracts/ws";
import { isEnvelope, isPong } from "../contracts/ws";
import { store } from "../store/store";

// WebSocket client: reconnect backoff, ACK queue + flush, clock-sync ping,
// per-frame rAF batching, and post-paint latency measurement.
export class Transport {
  private ws: WebSocket | null = null;
  private backoff = 1;
  private lastMsg = 0;
  private connected = false;
  private queue: Envelope[] = [];
  private rafPending = false;
  private ackQueue: string[] = [];
  private pingTimer = 0;
  private staleTimer = 0;
  private stopped = false;

  start(): void {
    this.connect();
    this.staleTimer = window.setInterval(() => {
      if (this.connected && Date.now() - this.lastMsg > 5000) store.setConn("stale");
    }, 1000);
  }

  stop(): void {
    this.stopped = true;
    window.clearInterval(this.staleTimer);
    window.clearInterval(this.pingTimer);
    if (this.ws) try { this.ws.close(); } catch { /* ignore */ }
  }

  sendAck(id: string): void {
    store.ackLocal(id);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ack: id }));
    } else if (!this.ackQueue.includes(id)) {
      this.ackQueue.push(id);
    }
  }

  private connect(): void {
    if (this.stopped) return;
    let ws: WebSocket;
    try {
      const proto = location.protocol === "https:" ? "wss://" : "ws://";
      ws = new WebSocket(proto + location.host + "/ws");
    } catch { this.schedule(); return; }
    this.ws = ws;

    ws.onopen = () => {
      this.connected = true;
      this.backoff = 1;
      this.lastMsg = Date.now();
      store.setConn("live");
      while (this.ackQueue.length) ws.send(JSON.stringify({ ack: this.ackQueue.shift() }));
      this.ping();
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.ping(), 3000);
    };
    ws.onmessage = (ev) => {
      this.lastMsg = Date.now();
      if (this.connected) store.setConn("live");
      let obj: unknown;
      try { obj = JSON.parse(ev.data as string); } catch { return; }
      if (isPong(obj)) { store.recordPong(obj.c, obj.s); return; }
      if (isEnvelope(obj)) { this.queue.push(obj); this.scheduleFlush(); }
    };
    ws.onclose = () => {
      this.connected = false;
      window.clearInterval(this.pingTimer);
      store.setConn("offline");
      this.schedule();
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }

  private ping(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ ctl: "ping", c: Date.now() }));
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    window.setTimeout(() => this.connect(), this.backoff * 1000);
    this.backoff = Math.min(this.backoff * 2, 5);
  }

  private scheduleFlush(): void {
    if (this.rafPending) return;
    this.rafPending = true;
    requestAnimationFrame(() => {
      this.rafPending = false;
      const batch = this.queue;
      this.queue = [];
      if (!batch.length) return;
      const th0 = performance.now();
      store.applyBatch(batch);
      const perf = (window as unknown as { __ultronPerf?: { handler: number[] } }).__ultronPerf;
      if (perf) {
        const per = (performance.now() - th0) / batch.length;
        for (let i = 0; i < batch.length; i++) perf.handler.push(per);
      }
      // Measure bus->screen after the browser has painted this commit.
      requestAnimationFrame(() => {
        const paint = Date.now();
        for (const env of batch) {
          if (env.t === "history" || env.t === "toast") continue;
          store.recordLatency(env.ts, paint);
        }
      });
    });
  }
}

export const transport = new Transport();
