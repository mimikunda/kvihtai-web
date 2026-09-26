// The live view: the set going on now, and the newest set once it is analysed.

import type { SetResult, Status } from "../api";
import { drawTrail, redrawOnResize } from "../charts";
import { h } from "../dom";
import { mps } from "../format";
import { store } from "../store";
import { setCard, type SetCard } from "./setCard";

export function nowView(root: HTMLElement): () => void {
  const trailCanvas = h("canvas", { "aria-label": "Bar path so far" });
  const speed = h("div", { class: "value" }, "0.00");
  const liveTitle = h("h2", {}, "Set in progress");
  const liveCard = h(
    "section",
    { class: "card live", hidden: true },
    h("div", { class: "card-head" }, liveTitle),
    h(
      "div",
      { class: "live-body" },
      trailCanvas,
      h("div", { class: "speed" }, speed, h("div", { class: "label" }, "m/s vertical")),
    ),
  );
  const analysing = h(
    "section",
    { class: "card", hidden: true },
    h("span", { class: "spinner" }),
    h("span", {}, "Analysing the set…"),
  );
  const latestSlot = h("div");
  root.append(liveCard, analysing, latestSlot);

  let card: SetCard | null = null;
  const showLatest = (result: SetResult | null) => {
    card?.destroy();
    card = null;
    latestSlot.replaceChildren();
    if (result) {
      card = setCard(result, "Latest set");
      latestSlot.append(card.el);
    } else {
      latestSlot.append(
        h(
          "section",
          { class: "card empty" },
          h("strong", {}, "No sets yet"),
          h("span", {
            html: 'Stand the camera side-on to the bar, with the plate in view, and lift. Sets appear here on their own. <a href="#/camera">Check the camera</a>',
          }),
        ),
      );
    }
  };

  const onStatus = (s: Status | null) => {
    const inSet = s?.state === "set";
    liveCard.hidden = !inSet;
    analysing.hidden = !(s && s.analysing > 0 && !inSet);
    if (inSet) drawTrail(trailCanvas, store.trail);
  };

  const offs = [
    store.on("status", onStatus),
    store.on("latest", showLatest),
    store.on("live", (live) => {
      if (liveCard.hidden) return;
      speed.textContent = mps(Math.abs(live.kinematics.current_velocity_mps));
      drawTrail(trailCanvas, store.trail);
    }),
    redrawOnResize(trailCanvas, () => drawTrail(trailCanvas, store.trail)),
  ];
  onStatus(store.status);
  showLatest(store.latest);

  return () => {
    offs.forEach((off) => off());
    card?.destroy();
  };
}
