// Setting up at the gym: what the camera sees, which plates the watcher has
// found, and the settings that decide whether it can see them. The steps are
// numbered in the order they are done. With the camera off to the side both
// ends of the bar are in view; a tap on the one nearer the camera tells the
// watcher which to follow.

import { api, problem, type CameraChange, type CameraState, type Status } from "../api";
import { h, icons } from "../dom";
import { store } from "../store";
import { toast } from "../ui";
import { alertBox, type Alert } from "./alerts";

const SVG = "http://www.w3.org/2000/svg";

// The focus slider runs in dioptres, 1 / distance, as the lens does: equal
// steps are equal changes in sharpness, and far away is a finite end.
const LENS_MAX = 4; // 0.25 m; nearer than that is never wanted at a platform

function circle(x: number, y: number, r: number, cls: string): SVGCircleElement {
  const c = document.createElementNS(SVG, "circle");
  c.setAttribute("cx", String(x));
  c.setAttribute("cy", String(y));
  c.setAttribute("r", String(r));
  c.setAttribute("class", cls);
  return c;
}

function distance(lens: number): string {
  return lens < 0.05 ? "far away" : `${(1 / lens).toFixed(1)} m`;
}

type StepState = "done" | "todo" | "neutral";

function step(n: number, title: string, ...body: (Node | string)[]): { el: HTMLElement; set: (state: StepState, note: string) => void } {
  const mark = h("span", { class: "step-mark" }, String(n));
  const note = h("span", { class: "step-note" });
  const el = h("div", { class: "step" }, h("div", { class: "step-head" }, mark, h("h3", {}, title), note), ...body);
  return {
    el,
    set: (state, text) => {
      el.dataset.state = state;
      mark.textContent = state === "done" ? "✓" : state === "todo" ? "!" : String(n);
      note.textContent = text;
    },
  };
}

export function cameraView(root: HTMLElement): () => void {
  let alive = true;
  let cam: CameraState | null = null;
  let tapping = false;

  // --- preview ---------------------------------------------------------------------------
  const img = h("img", { alt: "Camera preview" });
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  const live = h("div", { class: "live-chip" }, "Connecting…");
  const hint = h("div", { class: "hint" });
  const fullBtn = h("button", { class: "icon-btn full-open", type: "button", html: icons.expand, "aria-label": "Full screen" });
  const closeBtn = h("button", { class: "icon-btn full-close", type: "button", html: icons.close, "aria-label": "Close full screen" });
  const tapBtn = h("button", { class: "btn primary full-tap", type: "button" }, "Tap the near plate");
  const preview = h("div", { class: "preview" }, img, svg, live, fullBtn, closeBtn, h("div", { class: "preview-foot" }, hint, tapBtn));

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
      const f = store.status?.frame;
      const shown = f ? Math.min(preview.clientWidth, (preview.clientHeight * f.w) / f.h) : preview.clientWidth;
      const width = Math.min(960, Math.round(shown * Math.min(devicePixelRatio, 2)) || 480);
      const response = await fetch(api.previewUrl(width), { cache: "no-store", signal: AbortSignal.timeout(5000) });
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

  // Full screen: the Fullscreen API where there is one, and the page covered
  // where there is not (iPhone Safari has it only for video).
  const setFull = (on: boolean) => {
    preview.classList.toggle("full", on);
    document.body.classList.toggle("no-scroll", on);
    if (on && preview.requestFullscreen && !document.fullscreenElement) {
      preview.requestFullscreen().catch(() => undefined);
    } else if (!on && document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined);
    }
    if (!on && tapping) {
      tapping = false;
      showTapping();
    }
  };
  const onFullscreenChange = () => {
    if (!document.fullscreenElement && preview.classList.contains("full")) setFull(false);
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);
  fullBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setFull(true);
  });
  closeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    setFull(false);
  });

  const nearMark = (s: Status): SVGCircleElement[] => {
    const p = cam?.near_plate;
    if (!p || !s.frame) return [];
    return [circle(p[0] * s.frame.w, p[1] * s.frame.h, 0.012 * Math.max(s.frame.w, s.frame.h), "near")];
  };

  const showPreview = (s: Status | null) => {
    if (!s) return;
    if (s.frame) {
      svg.setAttribute("viewBox", `0 0 ${s.frame.w} ${s.frame.h}`);
      preview.style.setProperty("--ratio", String(s.frame.w / s.frame.h));
    }
    svg.replaceChildren(
      ...s.watched.map((p) => circle(p.x, p.y, p.r, "watched")),
      ...(s.plate ? [circle(s.plate.x, s.plate.y, s.plate.r, "followed")] : []),
      ...nearMark(s),
    );
    const still = store.stillFor;
    const frozen = s.state !== "set" && still >= 3;
    live.textContent = !store.connected
      ? "Offline"
      : frozen
        ? `Frozen · no picture for ${Math.round(still)} s`
        : s.state === "starting"
          ? "Starting…"
          : `Live · ${s.fps.toFixed(0)} fps`;
    live.className = `live-chip ${!store.connected || frozen || s.state === "camera error" ? "bad" : "good"}`;
    preview.classList.toggle("frozen", frozen);

    const n = s.watched.length;
    if (tapping) hint.textContent = "Tap the plate nearer the camera";
    else if (s.state === "set") hint.textContent = "Following the bar";
    else if (n === 0) hint.textContent = "No plate found yet";
    else hint.textContent = `${n === 1 ? "1 plate" : `${n} plates`} found${cam?.near_plate ? " · ● near plate" : ""}`;
  };

  // --- steps ------------------------------------------------------------------------------
  const change = async (c: CameraChange) => {
    try {
      cam = await api.changeCamera(c);
      showCamera();
    } catch (e) {
      toast(`The camera did not take the setting: ${problem(e)}`, "bad");
    }
  };

  // 1. which way is up
  const turnLeft = h("button", { class: "btn", type: "button", html: `${icons.rotLeft} Left`, "aria-label": "Rotate left" });
  const turnRight = h("button", { class: "btn", type: "button", html: `${icons.rotRight} Right`, "aria-label": "Rotate right" });
  turnLeft.addEventListener("click", () => cam && change({ quarter_turns: (cam.quarter_turns + 3) % 4 }));
  turnRight.addEventListener("click", () => cam && change({ quarter_turns: (cam.quarter_turns + 1) % 4 }));
  const upright = step(
    1,
    "Picture upright",
    h("p", { class: "step-text" }, "Turn the picture until the lifter stands upright in it. The analysis needs to know where down is."),
    h("div", { class: "row" }, turnLeft, turnRight),
  );

  // 2. focus
  let focusing = false;
  const lens = h("input", { type: "range", min: "0", max: String(LENS_MAX), step: "0.02", "aria-label": "Focus" }) as HTMLInputElement;
  const lensValue = h("b", {}, "–");
  // the slider's left end is near, its right end far away, as on a lens ring
  const lensFromSlider = () => LENS_MAX - +lens.value;
  lens.addEventListener("input", () => (lensValue.textContent = distance(lensFromSlider())));
  lens.addEventListener("change", () => change({ lens_position: Math.round(lensFromSlider() * 100) / 100 }));
  const autoFocus = h("button", { class: "btn", type: "button", html: `${icons.focus} Autofocus` }) as HTMLButtonElement;
  autoFocus.addEventListener("click", async () => {
    focusing = true;
    showCamera();
    try {
      await api.focus();
    } catch {
      focusing = false;
      toast("This camera cannot focus.", "bad");
      return;
    }
    // the lens moves for a second or two; the station says when it is done
    for (let i = 0; i < 16 && alive; i++) {
      await new Promise((r) => window.setTimeout(r, 500));
      try {
        cam = await api.camera();
      } catch {
        continue;
      }
      if (i >= 2 && cam.focus !== "focusing") break;
    }
    focusing = false;
    showCamera();
  });
  const focus = step(
    2,
    "Focus on the bar",
    h("p", { class: "step-text" }, "Autofocus on the plate, or set the distance from the camera to the bar by hand. Check it full screen."),
    h("div", { class: "row" }, autoFocus),
    h("div", { class: "control" }, h("div", { class: "label" }, h("span", {}, "Near · far"), lensValue), lens),
  );

  // 3. light
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
  const light = step(
    3,
    "Light",
    h("p", { class: "step-text" }, "A short exposure keeps a fast bar sharp. Auto brightness raises the gain to match the room."),
    h("div", { class: "control" }, h("div", { class: "label" }, h("span", {}, "Exposure · shorter is sharper"), exposureValue), exposure),
    h("div", { class: "control" }, h("div", { class: "label" }, h("label", { class: "switch" }, auto, "Auto brightness"), gainValue), gain),
  );

  // 4. the near plate. Once after setting up, not before every lift: it stays
  // on the same side of the picture until the camera is moved.
  const nearBtn = h("button", { class: "btn primary", type: "button" }, "Tap the near plate");
  const nearClear = h("button", { class: "btn", type: "button", html: `${icons.trash} Forget` });
  const near = step(
    4,
    "Near plate",
    h(
      "p",
      { class: "step-text" },
      "With the camera off to the side, both ends of the bar are in view. Tap the plate nearer the camera, once, and the station follows that one. Put the bar where it will be lifted first.",
    ),
    h("div", { class: "row" }, nearBtn, nearClear),
  );
  const startTapping = () => {
    tapping = true;
    setFull(true);
    showTapping();
  };
  nearBtn.addEventListener("click", startTapping);
  tapBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    tapping = !tapping;
    showTapping();
  });
  nearClear.addEventListener("click", () => void change({ near_plate: [] }));
  const showTapping = () => {
    preview.classList.toggle("tapping", tapping);
    tapBtn.textContent = tapping ? "Cancel" : cam?.near_plate ? "Change the near plate" : "Tap the near plate";
    tapBtn.classList.toggle("primary", !tapping);
    nearBtn.textContent = cam?.near_plate ? "Change it" : "Tap the near plate";
    nearClear.hidden = !cam?.near_plate;
    showPreview(store.status);
  };
  preview.addEventListener("click", (e) => {
    const frame = store.status?.frame;
    const ctm = svg.getScreenCTM();
    if (!tapping) {
      if (!preview.classList.contains("full")) setFull(true);
      return;
    }
    if (!frame || !ctm) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    const x = p.x / frame.w;
    const y = p.y / frame.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    tapping = false;
    void change({ near_plate: [x, y] }).then(() => window.setTimeout(() => setFull(false), 600));
  });

  const steps = h(
    "section",
    { class: "card steps" },
    h("div", { class: "card-head" }, h("h2", {}, "Set up the camera")),
    upright.el,
    focus.el,
    light.el,
    near.el,
  );

  const showCamera = () => {
    if (!cam) return;
    const canSet = cam.kind === "pi";
    auto.checked = cam.auto_gain;
    if (document.activeElement !== gain) gain.value = String(cam.gain_actual ?? cam.gain);
    gainValue.textContent = `${(cam.gain_actual ?? cam.gain).toFixed(1)}×`;
    if (document.activeElement !== exposure) exposure.value = String(cam.exposure_us);
    exposureValue.textContent = `${(cam.exposure_us / 1000).toFixed(1)} ms`;
    for (const el of [auto, gain, exposure, lens, autoFocus] as (HTMLButtonElement | HTMLInputElement)[]) {
      el.disabled = !canSet || (el === gain && cam.auto_gain) || (el === autoFocus && focusing);
    }

    upright.set("neutral", "");

    const at = cam.lens_actual ?? cam.lens_position;
    if (document.activeElement !== lens && at != null) lens.value = String(LENS_MAX - Math.min(at, LENS_MAX));
    lensValue.textContent = at == null ? "–" : distance(at);
    if (!canSet) focus.set("neutral", "this camera has no focus");
    else if (focusing || cam.focus === "focusing") focus.set("neutral", "focusing…");
    else if (cam.focus === "failed") focus.set("todo", `nothing sharp found; at ${at == null ? "?" : distance(at)}`);
    else if (at == null) focus.set("todo", "not focused yet");
    else focus.set(at > 2 ? "todo" : "done", `at ${distance(at)}${at > 2 ? ", too near" : ""}`);
    autoFocus.innerHTML = `${icons.focus} ${focusing ? "Focusing…" : "Autofocus"}`;

    const bright = cam.brightness == null ? null : Math.round((100 * cam.brightness) / 255);
    if (cam.too_dark) light.set("todo", `too dark${bright == null ? "" : `, ${bright} %`}`);
    else light.set(bright == null ? "neutral" : "done", bright == null ? "" : `brightness ${bright} %`);

    near.set(cam.near_plate ? "done" : "todo", cam.near_plate ? "set" : "not set");
    showTapping();
  };

  // --- what needs doing -------------------------------------------------------------------
  const alerts = alertBox((): Alert[] => {
    const out: Alert[] = [];
    if (cam?.too_dark) {
      out.push({ level: "warn", text: "Too dark: the gain is at its highest. Add light, or lengthen the exposure a little." });
    }
    const s = store.status;
    if (cam && !cam.near_plate && s && s.watched.length >= 2) {
      out.push({ level: "info", text: "Two plates in view and no near plate set: tap the near plate (step 4)." });
    }
    return out;
  });

  root.append(
    alerts.el,
    preview,
    steps,
    h("a", { class: "more-link", href: "#/station" }, "The station's state, problems, log and power are on Station →"),
  );

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

  const onStatus = (s: Status | null) => {
    showPreview(s);
    alerts.update();
  };
  const offs = [store.on("status", onStatus), store.on("connection", () => onStatus(store.status))];
  onStatus(store.status);
  void pollCamera();
  void refresh();

  return () => {
    alive = false;
    offs.forEach((off) => off());
    document.removeEventListener("fullscreenchange", onFullscreenChange);
    document.body.classList.remove("no-scroll");
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}
