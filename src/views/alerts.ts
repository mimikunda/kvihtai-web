// What is wrong with the station right now, in words, at the top of a view.
// Every problem the status can show is said here, so that nobody has to read
// the facts or the log to find out why nothing happens.

import type { Status } from "../api";
import { h } from "../dom";
import { store } from "../store";

export type Level = "bad" | "warn" | "info";

export interface Alert {
  level: Level;
  text: string;
}

// The station restarts itself 5 s after the camera stops; a poll or two later
// the app would say so anyway, so this only has to cover the gap.
const STILL_S = 3;
const RECENT_MIN = 15;

function minutesBetween(a: string, b: string): number {
  return (new Date(b).getTime() - new Date(a).getTime()) / 60000;
}

export function stationAlerts(s: Status | null, stillFor: number): Alert[] {
  if (!s) return [];
  const out: Alert[] = [];
  if (s.state === "camera error") {
    out.push({ level: "bad", text: `Camera error: ${s.error ?? "unknown"}. The station tries again every few seconds.` });
  } else if (s.state === "starting") {
    out.push({ level: "info", text: "The camera is starting…" });
  } else if (s.state === "no camera") {
    out.push({ level: "info", text: "This station runs without a camera." });
  } else if (stillFor >= STILL_S) {
    out.push({
      level: "bad",
      text: `No picture from the camera for ${Math.round(stillFor)} s. The station restarts itself; if this keeps happening, check the camera cable.`,
    });
  }

  const incidents = s.incidents ?? [];
  const recent = incidents.filter((i) => minutesBetween(i.at, s.clock.now) < RECENT_MIN);
  const today = incidents.filter((i) => i.at.slice(0, 10) === s.clock.now.slice(0, 10));
  if (recent.length) {
    const last = recent[recent.length - 1];
    const ago = Math.max(0, Math.round(minutesBetween(last.at, s.clock.now)));
    const times = today.length > 1 ? ` That is ${today.length} times today.` : "";
    out.push({ level: "warn", text: `${ago < 1 ? "Just now" : `${ago} min ago`}: ${last.what}.${times}` });
  }

  if (s.dropped >= 0.05) {
    out.push({ level: "warn", text: `The Pi is losing ${Math.round(100 * s.dropped)} % of the camera's frames.` });
  }
  if (s.system.undervoltage) {
    out.push({ level: "bad", text: "The power supply is too weak: the Pi reports undervoltage." });
  }
  if (s.system.throttled_now) {
    out.push({ level: "warn", text: "The Pi is too hot and has slowed down." });
  }
  if (s.recording?.error) {
    out.push({ level: "warn", text: `Recording failed: ${s.recording.error}` });
  }
  return out;
}

// A box of alerts that keeps itself up to date. extra adds what only one view knows.
export function alertBox(extra: () => Alert[] = () => []): { el: HTMLElement; update: () => void } {
  const el = h("div", { class: "alerts" });
  const update = () => {
    const all = [...stationAlerts(store.status, store.stillFor), ...extra()];
    el.replaceChildren(...all.map((a) => h("div", { class: `banner ${a.level}`, role: "status" }, a.text)));
  };
  return { el, update };
}
