import type { Rise } from "./api";

export const mps = (v: number | null | undefined): string => (v == null || !isFinite(v) ? "–" : v.toFixed(2));

export const cm = (mm: number | null | undefined): string => (mm == null ? "–" : Math.round(mm / 10).toString());

export function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 90) return "1 min ago";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

export function best(rises: Rise[]): Rise | null {
  return rises.reduce<Rise | null>(
    (b, r) => (b == null || r.mean_concentric_velocity_mps > b.mean_concentric_velocity_mps ? r : b),
    null,
  );
}

// Velocity loss from the fastest rep to the last one, the usual measure of
// fatigue in a set. It says nothing for a snatch or a clean, whose second
// rise is the stand from the catch, so it needs three reps or more.
export function velocityLoss(rises: Rise[]): number | null {
  if (rises.length < 3) return null;
  const top = Math.max(...rises.map((r) => r.mean_concentric_velocity_mps));
  const last = rises[rises.length - 1].mean_concentric_velocity_mps;
  return top > 0 ? (100 * (top - last)) / top : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
