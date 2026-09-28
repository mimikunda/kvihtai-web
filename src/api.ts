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
    load?: number;
  };
  clock: { offset_s: number; now: string };
  brightness: number | null;
}

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
  too_dark: boolean;
}

export type CameraChange = Partial<Pick<CameraState, "quarter_turns" | "exposure_us" | "gain" | "auto_gain">> & {
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

export interface Recordings {
  enabled: boolean;
  segments: { name: string; started_at: string; bytes: number; duration_s?: number; recording: boolean }[];
  total_bytes: number;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!response.ok) {
    throw new ApiError(response.status, await response.text());
  }
  return (await response.json()) as T;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    body: string,
  ) {
    super(`HTTP ${status}: ${body}`);
  }
}

export const api = {
  status: () => request<Status>("/api/v1/status"),
  sets: (limit = 200) => request<SetBrief[]>(`/api/v1/sets?limit=${limit}`),
  set: (id: string) => request<SetResult>(`/api/v1/sets/${encodeURIComponent(id)}`),
  deleteSet: (id: string) => request<{ deleted: string }>(`/api/v1/sets/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
