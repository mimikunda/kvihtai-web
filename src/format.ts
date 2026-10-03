import type { Rise, Tags } from "./api";

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

export function bytes(n: number | null | undefined): string {
  if (n == null) return "–";
  if (n === 0) return "0";
  if (n >= 1e9) return `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.max(1, Math.round(n / 1e3))} kB`;
}

export function duration(s: number | null | undefined): string {
  if (s == null) return "–";
  if (s < 120) return `${Math.round(s)} s`;
  if (s < 7200) return `${Math.round(s / 60)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  return `${Math.round(s / 86400)} days`;
}

export function kg(w: number | null | undefined): string {
  if (w == null) return "";
  return `${+w.toFixed(2)} kg`;
}

// "Snatch · 80 kg", or "" when nothing was said about the set.
export function tagLabel(tags: Tags | null | undefined): string {
  if (!tags) return "";
  return [tags.lift, kg(tags.weight_kg)].filter(Boolean).join(" · ");
}

export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// Lifts offered when saying what a set is; any other name can be typed.
export const LIFTS = ["Snatch", "Clean & jerk", "Clean", "Jerk", "Squat", "Front squat", "Deadlift", "Pull"];
