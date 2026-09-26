// Setting up at the gym: what the camera sees, which plates the watcher has
// found, and the settings that decide whether it can see them.

import { api, type CameraChange, type CameraState, type Status } from "../api";
import { h, icons } from "../dom";
import { store } from "../store";

const SVG = "http://www.w3.org/2000/svg";

function circle(x: number, y: number, r: number, cls: string): SVGCircleElement {
  const c = document.createElementNS(SVG, "circle");
  c.setAttribute("cx", String(x));
  c.setAttribute("cy", String(y));
  c.setAttribute("r", String(r));
  c.setAttribute("class", cls);
  return c;
}

function fact(label: string): [HTMLElement, HTMLElement] {
  const value = h("b", {}, "–");
  return [h("div", {}, h("span", {}, label), value), value];
}

export function cameraView(root: HTMLElement): () => void {
  let alive = true;
  let cam: CameraState | null = null;

  // --- preview ---------------------------------------------------------------------------
  const img = h("img", { alt: "Camera preview" });
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const hint = h("div", { class: "hint" }, "Connecting…");
  const preview = h("div", { class: "preview" }, img, svg, hint);

  let objectUrl: string | null = null;
  // A few pictures a second are enough to aim the camera. None during a set:
  // each one costs the Pi time it then does not have for the camera.
  const refresh = async () => {
    if (!alive) return;
    const started = performance.now();
    if (store.status?.state === "set") {
      window.setTimeout(refresh, 500);
      return;
    }
    try {
      const width = Math.min(960, Math.round(preview.clientWidth * Math.min(devicePixelRatio, 2)) || 480);
      const response = await fetch(api.previewUrl(width), { cache: "no-store" });
      if (response.ok) {
        const url = URL.createObjectURL(await response.blob());
        img.src = url;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = url;
      }
    } catch {
      // shown by the connection banner
    }
    const wait = Math.max(150, 350 - (performance.now() - started));
    if (alive && document.visibilityState === "visible") window.setTimeout(refresh, wait);
    else if (alive) document.addEventListener("visibilitychange", () => refresh(), { once: true });
  };

  const showStatus = (s: Status | null) => {
    if (!s) return;
    if (s.frame) {
      svg.setAttribute("viewBox", `0 0 ${s.frame.w} ${s.frame.h}`);
      preview.style.aspectRatio = `${s.frame.w} / ${s.frame.h}`;
      preview.style.maxWidth = `calc(62vh * ${s.frame.w / s.frame.h})`;
    }
    svg.replaceChildren(
      ...s.watched.map((p) => circle(p.x, p.y, p.r, "watched")),
      ...(s.plate ? [circle(s.plate.x, s.plate.y, s.plate.r, "followed")] : []),
    );
    if (s.state === "set") hint.textContent = "Following the bar";
    else if (s.state === "camera error") hint.textContent = "Camera error";
    else if (s.watched.length === 0) hint.textContent = "No plate in view";
    else hint.textContent = s.watched.length === 1 ? "1 plate in view" : `${s.watched.length} plates in view`;
    showFacts(s);
  };

  // --- settings ---------------------------------------------------------------------------
  const change = async (c: CameraChange) => {
    try {
      cam = await api.changeCamera(c);
      showCamera();
    } catch {
      alert("The camera did not take the setting.");
    }
  };

  const turnLeft = h("button", { class: "btn", type: "button", html: `${icons.rotLeft} Rotate`, "aria-label": "Rotate left" });
  const turnRight = h("button", { class: "btn", type: "button", html: `${icons.rotRight} Rotate`, "aria-label": "Rotate right" });
  turnLeft.addEventListener("click", () => cam && change({ quarter_turns: (cam.quarter_turns + 3) % 4 }));
  turnRight.addEventListener("click", () => cam && change({ quarter_turns: (cam.quarter_turns + 1) % 4 }));

  const focusNote = h("span", { class: "switch" });
  const focusBtn = h("button", {
    class: "btn",
    type: "button",
    html: `${icons.focus} Focus`,
    onclick: async () => {
      focusNote.textContent = "Focusing…";
      try {
        await api.focus();
        window.setTimeout(async () => {
          cam = await api.camera();
          showCamera();
        }, 3000);
      } catch {
        focusNote.textContent = "This camera cannot focus";
      }
    },
  });

  const auto = h("input", { type: "checkbox" }) as HTMLInputElement;
  auto.addEventListener("change", () => change({ auto_gain: auto.checked }));
  const gain = h("input", { type: "range", min: "1", max: "16", step: "0.5" }) as HTMLInputElement;
  const gainValue = h("b", {}, "–");
  gain.addEventListener("input", () => (gainValue.textContent = `${(+gain.value).toFixed(1)}×`));
  gain.addEventListener("change", () => change({ gain: +gain.value, auto_gain: false }));
  const exposure = h("input", { type: "range", min: "500", max: "6000", step: "100" }) as HTMLInputElement;
  const exposureValue = h("b", {}, "–");
  exposure.addEventListener("input", () => (exposureValue.textContent = `${(+exposure.value / 1000).toFixed(1)} ms`));
  exposure.addEventListener("change", () => change({ exposure_us: +exposure.value }));
  const dark = h("div", { class: "banner warn", hidden: true }, "Too dark: the gain is at its highest. Add light, or lengthen the exposure a little.");

  const controls = h(
    "section",
    { class: "card controls" },
    h("div", { class: "card-head" }, h("h2", {}, "Camera"), focusNote),
    h("div", { class: "row" }, turnLeft, turnRight, focusBtn),
    dark,
    h(
      "div",
      { class: "control" },
      h("div", { class: "label" }, h("span", {}, "Exposure · shorter is sharper"), exposureValue),
      exposure,
    ),
    h(
      "div",
      { class: "control" },
      h("div", { class: "label" }, h("label", { class: "switch" }, auto, "Auto brightness"), gainValue),
      gain,
    ),
  );

  const showCamera = () => {
    if (!cam) return;
    auto.checked = cam.auto_gain;
    gain.disabled = cam.auto_gain;
    if (document.activeElement !== gain) gain.value = String(cam.gain_actual ?? cam.gain);
    gainValue.textContent = `${(cam.gain_actual ?? cam.gain).toFixed(1)}×`;
    if (document.activeElement !== exposure) exposure.value = String(cam.exposure_us);
    exposureValue.textContent = `${(cam.exposure_us / 1000).toFixed(1)} ms`;
    dark.hidden = !cam.too_dark;
    const lens = cam.lens_actual ?? cam.lens_position;
    if (focusNote.textContent !== "This camera cannot focus") {
      focusNote.textContent = lens ? `focused at ${(1 / Math.max(lens, 0.01)).toFixed(1)} m` : "";
    }
    const canSet = cam.kind === "pi";
    for (const el of [turnLeft, turnRight]) el.disabled = false;
    for (const el of [focusBtn, auto, gain, exposure] as (HTMLButtonElement | HTMLInputElement)[]) {
      el.disabled = !canSet || (el === gain && cam.auto_gain);
    }
    brightness.textContent = cam.brightness == null ? "–" : `${Math.round((100 * cam.brightness) / 255)} %`;
  };

  // --- station ----------------------------------------------------------------------------
  const [stateFact, state] = fact("State");
  const [fpsFact, fps] = fact("Frame rate");
  const [tempFact, temp] = fact("Temperature");
  const [powerFact, power] = fact("Power");
  const [recFact, rec] = fact("Recording");
  const [freeFact, free] = fact("Free space");
  const [clockFact, clock] = fact("Station clock");
  const [brightFact, brightness] = fact("Brightness");
  const station = h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, "Station")),
    h("div", { class: "facts" }, stateFact, fpsFact, brightFact, tempFact, powerFact, clockFact, recFact, freeFact),
  );

  const showFacts = (s: Status) => {
    state.textContent = s.error ? `${s.state}: ${s.error}` : s.state;
    fps.textContent = `${s.fps.toFixed(0)} fps${s.dropped >= 0.02 ? `, ${Math.round(100 * s.dropped)} % lost` : ""}`;
    fps.classList.toggle("bad", s.dropped >= 0.05);
    const t = s.system.temp_c;
    temp.textContent = t === undefined ? "–" : `${t.toFixed(0)} °C${s.system.throttled_now ? ", slowed down" : ""}`;
    temp.classList.toggle("bad", (t ?? 0) >= 80 || !!s.system.throttled_now);
    power.textContent = s.system.undervoltage ? "Too low" : "OK";
    power.classList.toggle("bad", !!s.system.undervoltage);
    rec.textContent = s.recording ? (s.recording.error ? `error: ${s.recording.error}` : s.recording.file ?? "off") : "off";
    free.textContent = s.recording ? `${s.recording.free_gb.toFixed(0)} GB` : "–";
    free.classList.toggle("bad", !!s.recording && s.recording.free_gb < 8);
    clock.textContent = new Date(s.clock.now).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
  };

  // --- log -------------------------------------------------------------------------------
  const logText = h("pre", { class: "log" });
  const logBox = h("details", { class: "card" }, h("summary", {}, "Log"), logText);
  const loadLog = async () => {
    if (!alive || !logBox.open) return;
    try {
      logText.textContent = (await api.log()).slice().reverse().join("\n") || "Nothing yet.";
    } catch {
      logText.textContent = "Could not load the log.";
    }
    window.setTimeout(loadLog, 3000);
  };
  logBox.addEventListener("toggle", loadLog);

  root.append(preview, controls, station, logBox);

  const pollCamera = async () => {
    if (!alive) return;
    try {
      cam = await api.camera();
      showCamera();
    } catch {
      // the status poll reports the connection
    }
    window.setTimeout(pollCamera, 2000);
  };

  const off = store.on("status", showStatus);
  showStatus(store.status);
  void pollCamera();
  void refresh();

  return () => {
    alive = false;
    off();
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}
