// One analysed set: its reps, bar path, velocity curve and video.

import type { Rise, SetResult } from "../api";
import { drawBarPath, drawOverlay, drawVelocity, redrawOnResize } from "../charts";
import { h } from "../dom";
import { ago, best, clockTime, cm, mps, seconds, velocityLoss } from "../format";

export interface SetCard {
  el: HTMLElement;
  destroy(): void;
}

export function rises(result: SetResult): Rise[] {
  return result.movements.flatMap((m) => m.rises);
}

function stat(label: string, value: string, unit: string, tone = ""): HTMLElement {
  return h(
    "div",
    { class: `stat ${tone}` },
    h("div", { class: "label" }, label),
    h("div", { class: "value" }, value, h("span", { class: "unit" }, unit)),
  );
}

export function setCard(result: SetResult, title: string, actions?: HTMLElement): SetCard {
  const reps = rises(result);
  const top = best(reps);
  const loss = velocityLoss(reps);
  let selected: number | null = null;
  const cleanups: (() => void)[] = [];

  const when = h("span", { class: "when num" }, `${clockTime(result.started_at)} · ${ago(result.started_at)}`);
  const hero = h(
    "div",
    { class: "hero" },
    stat("Reps", String(reps.length), ""),
    stat("Best mean", mps(top?.mean_concentric_velocity_mps), "m/s", "accent"),
    loss !== null
      ? stat("Velocity loss", Math.round(loss).toString(), "%")
      : stat("Best peak", mps(Math.max(...reps.map((r) => r.peak_velocity_mps))), "m/s", "velocity"),
  );

  const maxMean = Math.max(...reps.map((r) => r.mean_concentric_velocity_mps), 0.01);
  const repButtons = reps.map((r, i) =>
    h(
      "button",
      { class: "rep", type: "button", onclick: () => select(selected === i ? null : i) },
      h("i", { class: "bar", style: `width:${(100 * r.mean_concentric_velocity_mps) / maxMean}%` }),
      h("span", { class: "n" }, `#${i + 1}`),
      h("span", { class: "v" }, mps(r.mean_concentric_velocity_mps), h("small", {}, "m/s mean")),
      h("span", { class: "more" }, `peak ${mps(r.peak_velocity_mps)} · ${cm(r.height_mm)} cm`),
    ),
  );
  const repList = h("div", { class: "reps" }, ...repButtons);

  const pathCanvas = h("canvas", { "aria-label": "Bar path" });
  const velCanvas = h("canvas", { "aria-label": "Vertical velocity over time" });
  const charts = h(
    "div",
    { class: "charts" },
    h("div", { class: "chart path" }, h("div", { class: "title" }, h("span", {}, "Bar path"), h("span", {}, "side view")), pathCanvas),
    h("div", { class: "chart velocity" }, h("div", { class: "title" }, h("span", {}, "Vertical velocity"), h("span", {}, "m/s")), velCanvas),
  );

  const draw = () => {
    drawBarPath(pathCanvas, result.trajectory, reps, selected);
    drawVelocity(velCanvas, result.trajectory, reps, selected);
  };
  cleanups.push(redrawOnResize(pathCanvas, draw), redrawOnResize(velCanvas, draw));

  let video: HTMLVideoElement | null = null;
  let videoWrap: HTMLElement | null = null;
  if (result.video && result.frame_size) {
    const v = result.video;
    const frame = result.frame_size;
    video = h("video", { src: v.url, controls: true, playsinline: true, muted: true, preload: "metadata" });
    const overlay = h("canvas");
    videoWrap = h("div", { class: "video-wrap" }, video, overlay);
    const vid = video;
    let handle = 0;
    let alive = true;
    const paint = () => drawOverlay(overlay, vid, result.trajectory, frame, vid.currentTime * 1000 + v.t0_ms);
    const loop = () => {
      if (!alive) return;
      paint();
      if ("requestVideoFrameCallback" in vid) {
        handle = vid.requestVideoFrameCallback(loop);
      } else {
        handle = requestAnimationFrame(loop);
      }
    };
    vid.addEventListener("loadeddata", paint);
    vid.addEventListener("seeked", paint);
    loop();
    cleanups.push(() => {
      alive = false;
      if ("cancelVideoFrameCallback" in vid) vid.cancelVideoFrameCallback(handle);
      else cancelAnimationFrame(handle);
      vid.pause();
      vid.removeAttribute("src");
      vid.load();
    });
  }

  function select(i: number | null): void {
    selected = i;
    repButtons.forEach((b, j) => b.classList.toggle("selected", j === i));
    draw();
    if (video && i !== null && result.video) {
      video.currentTime = Math.max(0, (reps[i].start_ms - result.video.t0_ms) / 1000 - 0.3);
    }
  }

  const angle = result.camera?.angle_deg;
  const lost = result.lost_frames ?? 0;
  const foot = [
    `${result.measured}/${result.frames} frames measured`,
    lost > 0 ? `${lost} lost live` : "",
    `${seconds(result.duration_ms)}`,
    angle !== undefined ? `camera ${Math.round(angle)}° off square${result.camera.angle_corrected ? ", corrected" : ""}` : "",
  ].filter(Boolean);

  const el = h(
    "section",
    { class: "card" },
    h("div", { class: "card-head" }, h("h2", {}, title), when),
    hero,
    reps.length ? repList : h("p", { class: "footnote" }, "No rep was found in this set."),
    charts,
    videoWrap,
    h("div", { class: "footnote" }, foot.join(" · ")),
    actions ?? null,
  );

  // draw once the card is in the page and has a size
  requestAnimationFrame(draw);
  const tick = window.setInterval(() => {
    when.textContent = `${clockTime(result.started_at)} · ${ago(result.started_at)}`;
  }, 30000);
  cleanups.push(() => window.clearInterval(tick));

  return { el, destroy: () => cleanups.forEach((fn) => fn()) };
}
