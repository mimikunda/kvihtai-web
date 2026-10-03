// What the app knows about the station, shared by the views.
//
// The status is polled once a second while the page is visible. The live
// stream runs only while a set is going on, since it is the only time it says
// anything. The newest set is fetched whenever the status names a new one.

import { api, ApiError, LiveStream, type Live, type SetResult, type Status } from "./api";

type Events = {
  status: Status | null;
  live: Live;
  latest: SetResult | null;
  connection: boolean;
};

type Listener<T> = (value: T) => void;

class Store {
  status: Status | null = null;
  connected = true;
  // the station answers, but its status with an error: a fault in the station, not the Wi-Fi
  broken: string | null = null;
  latest: SetResult | null = null;
  trail: { x: number; y: number }[] = [];
  lastLive: Live | null = null;
  private listeners = new Map<keyof Events, Set<Listener<never>>>();
  private failures = 0;
  private timer: number | undefined;
  private stream = new LiveStream((live) => this.onLive(live));
  private streaming = false;
  private latestId: string | null | undefined = undefined;
  private framesIn = -1;
  private framesAt = 0;

  on<K extends keyof Events>(event: K, fn: Listener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as Listener<never>);
    return () => {
      set.delete(fn as Listener<never>);
    };
  }

  private emit<K extends keyof Events>(event: K, value: Events[K]): void {
    this.listeners.get(event)?.forEach((fn) => (fn as Listener<Events[K]>)(value));
  }

  start(): void {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.poll();
    });
    api.clock().catch(() => undefined);
    this.poll();
    void this.loadLatest();
  }

  private async poll(): Promise<void> {
    window.clearTimeout(this.timer);
    try {
      const status = await api.status();
      this.failures = 0;
      if (this.broken) {
        this.broken = null;
        this.emit("connection", true);
      }
      if (!this.connected) {
        this.connected = true;
        this.emit("connection", true);
        api.clock().catch(() => undefined);
      }
      if (status.frames_in !== this.framesIn) {
        this.framesIn = status.frames_in;
        this.framesAt = performance.now();
      }
      this.status = status;
      this.emit("status", status);
      this.follow(status.state === "set");
      if (status.last_set_id && status.last_set_id !== this.latestId) void this.loadLatest();
    } catch (e) {
      if (e instanceof ApiError) {
        this.failures = 0;
        this.broken = e.detail || `error ${e.status}`;
        this.emit("connection", true);
      } else if (++this.failures >= 3 && this.connected) {
        this.connected = false;
        this.emit("connection", false);
      }
    }
    if (document.visibilityState === "visible") {
      this.timer = window.setTimeout(() => this.poll(), this.status?.state === "set" ? 500 : 1000);
    }
  }

  // Seconds since the camera last sent a frame, as far as the polls can tell.
  get stillFor(): number {
    return this.framesIn < 0 ? 0 : (performance.now() - this.framesAt) / 1000;
  }

  private follow(on: boolean): void {
    if (on && !this.streaming) {
      this.trail = [];
      this.stream.open();
      this.streaming = true;
    } else if (!on && this.streaming) {
      this.stream.close();
      this.streaming = false;
    }
  }

  private onLive(live: Live): void {
    this.lastLive = live;
    if (live.lift_state === "active") {
      const last = this.trail[this.trail.length - 1];
      const p = { x: live.bar_center.x_mm, y: live.bar_center.y_mm };
      if (!last || last.x !== p.x || last.y !== p.y) this.trail.push(p);
      if (this.trail.length > 2000) this.trail.splice(0, this.trail.length - 2000);
    }
    this.emit("live", live);
  }

  async loadLatest(): Promise<void> {
    try {
      const sets = await api.sets(1);
      const id = sets[0]?.set_id ?? null;
      this.latestId = id;
      this.latest = id ? await api.set(id) : null;
      this.emit("latest", this.latest);
    } catch {
      // the next status poll tries again
      this.latestId = undefined;
    }
  }

  forgetLatest(id: string): void {
    if (this.latest?.set_id === id) void this.loadLatest();
  }
}

export const store = new Store();
