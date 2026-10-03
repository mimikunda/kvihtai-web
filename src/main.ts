import "./style.css";

import type { Status } from "./api";
import { h, icons } from "./dom";
import { store } from "./store";
import { cameraView } from "./views/camera";
import { detailView } from "./views/detail";
import { historyView } from "./views/history";
import { nowView } from "./views/now";
import { stationView } from "./views/station";

const STATES: Record<Status["state"], [string, string]> = {
  watching: ["watching", "Watching"],
  set: ["set", "Set in progress"],
  analysing: ["analysing", "Analysing"],
  starting: ["", "Starting"],
  "camera error": ["error", "Camera error"],
  "no camera": ["", "No camera"],
};

const pill = h("span", { class: "pill" }, h("span", { class: "dot" }), h("span", {}, "Connecting"));
const rec = h("span", { class: "pill rec", hidden: true, title: "Recording" }, h("span", { class: "dot" }), "REC");
const header = h("header", { class: "topbar" }, h("div", { class: "brand", html: `${icons.logo}<span>KvihtAI</span>` }), rec, pill);
const banner = h("div", { class: "banner", hidden: true }, "Not connected to the station. Join the KvihtAI Wi-Fi and keep this page open.");
const main = h("main");
const tabs = {
  now: h("a", { href: "#/", html: `${icons.now}<span>Now</span>` }),
  history: h("a", { href: "#/history", html: `${icons.history}<span>History</span>` }),
  camera: h("a", { href: "#/camera", html: `${icons.camera}<span>Camera</span>` }),
  station: h("a", { href: "#/station", html: `${icons.station}<span>Station</span>` }),
};
const nav = h("nav", { class: "tabbar" }, tabs.now, tabs.history, tabs.camera, tabs.station);
document.getElementById("app")!.append(header, main, nav);

// A dot on the Station tab while a problem from the last quarter of an hour stands.
const RECENT_MS = 15 * 60000;
function markStation(s: Status | null): void {
  const last = s?.incidents?.[s.incidents.length - 1];
  const recent = !!last && !!s && new Date(s.clock.now).getTime() - new Date(last.at).getTime() < RECENT_MS;
  tabs.station.classList.toggle("alert", recent || !!store.broken || !!s?.system.undervoltage);
}

store.on("status", (s) => {
  markStation(s);
  if (!s) return;
  const [cls, label] = STATES[s.state] ?? ["", s.state];
  pill.className = `pill ${cls}`;
  pill.lastElementChild!.textContent = label;
  rec.hidden = !s.recording?.file;
});

store.on("connection", (ok) => {
  markStation(store.status);
  banner.hidden = ok;
  if (!ok) {
    pill.className = "pill offline";
    pill.lastElementChild!.textContent = "Offline";
  }
});

let unmount: (() => void) | null = null;

function route(): void {
  unmount?.();
  main.replaceChildren(banner);
  const path = location.hash.replace(/^#/, "") || "/";
  const view = h("div", { class: "controls" });
  main.append(view);
  let tab: keyof typeof tabs = "now";
  if (path.startsWith("/set/")) {
    tab = "history";
    unmount = detailView(view, decodeURIComponent(path.slice(5)));
  } else if (path === "/history") {
    tab = "history";
    unmount = historyView(view);
  } else if (path === "/camera") {
    tab = "camera";
    unmount = cameraView(view);
  } else if (path === "/station") {
    tab = "station";
    unmount = stationView(view);
  } else {
    unmount = nowView(view);
  }
  for (const [name, a] of Object.entries(tabs)) a.classList.toggle("active", name === tab);
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
route();
store.start();
