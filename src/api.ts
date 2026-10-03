// The station's API, served by kvihtai-core on the same host and port.

export interface Plate {
  x: number;
  y: number;
  r: number;
}

export interface Status {
  state: "watching" | "set" | "analysing" | "starting" | "camera error" | "no camera";
  error: string | null;
  camera: string;
  fps: number;
  dropped: number;
  frames_in: number;
  frame: { w: number; h: number } | null;
  watched: Plate[];
  plate: Plate | null;
  analysing: number;
  last_set_id: string | null;
  recording: { file: string | null; error: string | null; free_gb: number } | null;
  system: {
    temp_c?: number;
    throttled_now?: boolean;
    throttled_since_boot?: boolean;
    undervoltage?: boolean;
    undervoltage_since_boot?: boolean;
    mem_total_mb?: number;
    mem_available_mb?: number;
    load?: number;
  };
  clock: { offset_s: number; now: string };
  brightness: number | null;
  uptime_s?: number;
  // what went wrong before, kept across restarts; newest last
  incidents?: Incident[];
  next_set?: NextSet;
}

export interface Incident {
  at: string;
  what: string;
  // camera, power, crash, analysis, undervoltage, heat, storage; missing on older ones
  kind?: string;
}

// What the lifter says a set was.
export interface Tags {
  lift: string | null;
  weight_kg: number | null;
  note?: string | null;
}

export type NextSet = Pick<Tags, "lift" | "weight_kg">;

export interface Rise {
  start_ms: number;
  end_ms: number;
  height_mm: number;
  mean_concentric_velocity_mps: number;
  peak_velocity_mps: number;
  peak_ms: number;
}

export interface CameraGeometry {
  angle_deg: number;
  axis_ratio: number;
  angle_corrected: boolean;
  mm_per_px: number | null;
}

export interface SetBrief {
  set_id: string;
  started_at: string;
  duration_ms: number;
  frames: number;
  measured: number;
  camera: CameraGeometry;
  rises: Rise[];
  has_video: boolean;
  lost_frames?: number;
  tags?: Tags | null;
}

export interface TrajectoryPoint {
  t_ms: number;
  x_mm: number;
  y_mm: number;
  vy_mps: number | null;
  x_px?: number;
  y_px?: number;
}

export interface Movement {
  start_ms: number;
  end_ms: number;
  low_mm: number;
  high_mm: number;
  rises: Rise[];
}

export interface SetResult {
  set_id: string;
  started_at: string;
  frames: number;
  measured: number;
  rejected: Record<string, number>;
  frame_size?: [number, number];
  duration_ms: number;
  camera: CameraGeometry;
  metrics: { vertical_displacement_mm: number; horizontal_deviation_mm: number };
  movements: Movement[];
  trajectory: TrajectoryPoint[];
  ended?: string;
  lost_frames?: number;
  analysis_s?: number;
  video?: { url: string; t0_ms: number };
  tags?: Tags | null;
}

export interface CameraState {
  quarter_turns: number;
  exposure_us: number;
  gain: number;
  auto_gain: boolean;
  lens_position: number | null;
  // a tap on the plate nearer the camera, (x, y) from 0 to 1 across the upright picture
  near_plate: [number, number] | null;
  kind: string;
  exposure_actual_us: number | null;
  gain_actual: number | null;
  lens_actual: number | null;
  lux: number | null;
  brightness: number | null;
  focus?: "focusing" | "focused" | "failed" | null;
  too_dark: boolean;
}

export type CameraChange = Partial<
  Pick<CameraState, "quarter_turns" | "exposure_us" | "gain" | "auto_gain"> & { lens_position: number }
> & {
  near_plate?: number[]; // an empty list forgets it
};

// The live stream, as docs/API_CONTRACT.md in kvihtai-core describes it.
export interface Live {
  timestamp_ms: number;
  frame_id: number;
  lift_state: "idle" | "active" | "completed" | "failed";
  bar_center: { x_mm: number; y_mm: number };
  kinematics: { current_velocity_mps: number; acceleration_mps2: number };
  phase: string;
}

export interface Segment {
  name: string;
  started_at?: string;
  bytes: number;
  duration_s?: number;
  recording: boolean;
  // why it is kept from being deleted for space, if it is
  keep?: string | null;
}

export interface Recordings {
  enabled: boolean;
  segments: Segment[];
  total_bytes: number;
}

export type PowerAction = "restart" | "reboot" | "shutdown";

export interface SystemInfo {
  hostname: string;
  model: string;
  os: string;
  kernel: string;
  python: string;
  version: string | null;
  booted_s: number | null;
  memory: { total_mb: number; available_mb: number } | null;
  disk: { total_gb: number; free_gb: number } | null;
  throttled: {
    now: Record<string, boolean>;
    since_boot: Record<string, boolean>;
    raw: string;
  } | null;
  network: { addresses: { interface: string; address: string }[]; wifi: string | null; hotspot: boolean };
  power: Record<PowerAction, boolean> & { why: Partial<Record<PowerAction, string>> };
  service: boolean;
  storage: { recordings_bytes: number; sets_bytes: number; logs_bytes: number };
}

export interface Journal {
  available: boolean;
  lines: string[];
  error: string | null;
}

export interface Boot {
  index: number;
  id: string;
  first: string | null;
  last: string | null;
}

// A request that gets no answer is given up on: on the Pi's hotspot a phone
// that walked out of range can leave one hanging for minutes, and the status
// poll waits for it.
const TIMEOUT_MS = 8000;

async function request<T>(path: string, init?: RequestInit & { timeout?: number }): Promise<T> {
  const abort = new AbortController();
  const timer = window.setTimeout(() => abort.abort(), init?.timeout ?? TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      signal: abort.signal,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch (e) {
    throw new NetworkError(abort.signal.aborted ? "no answer" : String(e));
  } finally {
    window.clearTimeout(timer);
  }
  if (!response.ok) {
    throw new ApiError(response.status, await response.text().catch(() => ""));
  }
  return (await response.json()) as T;
}

// The station answered, but with an error.
export class ApiError extends Error {
  readonly detail: string;

  constructor(
    readonly status: number,
    body: string,
  ) {
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { detail?: unknown };
      if (typeof parsed.detail === "string") detail = parsed.detail;
    } catch {
      // not JSON: the body as it is
    }
    super(`HTTP ${status}: ${detail}`);
    this.detail = detail;
  }
}

// The station did not answer at all.
export class NetworkError extends Error {}

// What went wrong, in words for the person holding the phone.
export function problem(e: unknown): string {
  if (e instanceof ApiError) return e.detail || `The station answered with error ${e.status}.`;
  if (e instanceof NetworkError) return "The station did not answer. Is the phone still on its Wi-Fi?";
  return String(e);
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) });

export const api = {
  status: () => request<Status>("/api/v1/status", { timeout: 5000 }),
  health: () => request<{ status: string }>("/health", { timeout: 2500 }),
  sets: (limit = 500) => request<SetBrief[]>(`/api/v1/sets?limit=${limit}`),
  set: (id: string) => request<SetResult>(`/api/v1/sets/${encodeURIComponent(id)}`),
  deleteSet: (id: string) => request<{ deleted: string }>(`/api/v1/sets/${encodeURIComponent(id)}`, { method: "DELETE" }),
  tagSet: (id: string, tags: Partial<Tags>) =>
    request<SetResult>(`/api/v1/sets/${encodeURIComponent(id)}`, { method: "PATCH", ...json(tags) }),
  nextSet: (tags: Partial<NextSet>) => request<NextSet>("/api/v1/next-set", { method: "PUT", ...json(tags) }),
  missed: () => request<{ kept: string[] }>("/api/v1/missed", { method: "POST" }),
  keepRecording: (name: string, keep: boolean) =>
    request<{ name: string; keep: string | null }>(`/api/v1/recordings/${encodeURIComponent(name)}`, {
      method: "PUT",
      ...json({ keep }),
    }),
  system: () => request<SystemInfo>("/api/v1/system", { timeout: 15000 }),
  power: (action: PowerAction) => request<{ action: string }>("/api/v1/system/power", { method: "POST", ...json({ action }) }),
  incidents: () => request<Incident[]>("/api/v1/incidents"),
  clearIncidents: () => request<{ cleared: boolean }>("/api/v1/incidents", { method: "DELETE" }),
  stationLog: (lines: number, problems: boolean) =>
    request<{ records: string[] }>(`/api/v1/system/log?lines=${lines}&problems=${problems}`),
  journal: (source: string, boot: number, lines: number, problems: boolean) =>
    request<Journal>(`/api/v1/system/journal?source=${source}&boot=${boot}&lines=${lines}&problems=${problems}`, {
      timeout: 20000,
    }),
  boots: () => request<Boot[]>("/api/v1/system/boots", { timeout: 15000 }),
  diagnosticsUrl: "/api/v1/system/diagnostics.zip",
  csvUrl: "/api/v1/sets.csv",
  recordingUrl: (name: string) => `/api/v1/recordings/${encodeURIComponent(name)}`,
  camera: () => request<CameraState>("/api/v1/camera"),
  changeCamera: (change: CameraChange) =>
    request<CameraState>("/api/v1/camera", { method: "PUT", body: JSON.stringify(change) }),
  focus: () => request<{ focusing: boolean }>("/api/v1/camera/focus", { method: "POST" }),
  clock: () => request<{ adjusted: boolean; by_s: number }>("/api/v1/clock", {
    method: "POST",
    body: JSON.stringify({ epoch_ms: Date.now() }),
  }),
  log: () => request<string[]>("/api/v1/log"),
  recordings: () => request<Recordings>("/api/v1/recordings"),
  previewUrl: (width: number) => `/api/v1/camera/preview.jpg?width=${Math.round(width)}&t=${Date.now()}`,
};

// The live stream. It reconnects by itself: the phone drops off the Pi's
// hotspot when the screen goes dark, and comes back when it lights up.
export class LiveStream {
  private socket: WebSocket | null = null;
  private retry = 0;
  private closed = false;
  private timer: number | undefined;

  constructor(private readonly onMessage: (live: Live) => void) {}

  open(): void {
    this.closed = false;
    this.connect();
  }

  close(): void {
    this.closed = true;
    window.clearTimeout(this.timer);
    this.socket?.close();
    this.socket = null;
  }

  private connect(): void {
    const scheme = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${scheme}://${location.host}/ws/live`);
    this.socket = socket;
    socket.onopen = () => {
      this.retry = 0;
    };
    socket.onmessage = (event) => {
      this.onMessage(JSON.parse(event.data as string) as Live);
    };
    socket.onclose = () => {
      if (this.closed) return;
      const delay = Math.min(5000, 500 * 2 ** this.retry++);
      this.timer = window.setTimeout(() => this.connect(), delay);
    };
  }
}
