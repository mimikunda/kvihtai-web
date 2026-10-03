// The live view: the set going on now, and the newest set once it is analysed.

import { api, problem, type SetResult, type Status } from "../api";
import { drawTrail, redrawOnResize } from "../charts";
import { h } from "../dom";
import { mps, tagLabel } from "../format";
import { store } from "../store";
import { confirmSheet, toast } from "../ui";
import { alertBox } from "./alerts";
import { setCard, type SetCard } from "./setCard";
import { nextSetCard } from "./tags";

// Lifted, and no set came: keep the recording of it, which is what the
// watcher most needs to get better.
async function reportMissed(): Promise<void> {
  const yes = await confirmSheet(
    "Keep the recording?",
    [
      "The station keeps the last 5 minutes of what the camera saw, and does not delete them to make room.",
      "They are what is needed to make the station notice sets like that one.",
    ],
    "Keep it",
  );
  if (!yes) return;
  try {
    const { kept } = await api.missed();
    toast(kept.length ? "Kept. Thank you; it is on Station, under Recordings." : "Nothing to keep yet.", "good", 5000);
  } catch (e) {
    toast(problem(e), "bad");
  }
}

export function nowView(root: HTMLElement): () => void {
  const trailCanvas = h("canvas", { "aria-label": "Bar path so far" });
  const speed = h("div", { class: "value" }, "0.00");
  const liveTitle = h("h2", {}, "Set in progress");
  const liveTags = h("span", { class: "when" });
  const liveCard = h(
    "section",
    { class: "card live", hidden: true },
    h("div", { class: "card-head" }, liveTitle, liveTags),
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
  const alerts = alertBox();
  const next = nextSetCard();
  const missed = h(
    "div",
    { class: "missed", hidden: true },
    h("span", {}, "Lifted, and no set came up?"),
    h("button", { class: "btn small", type: "button", onclick: () => void reportMissed() }, "Keep the recording"),
  );
  root.append(alerts.el, liveCard, analysing, next.el, latestSlot, missed);

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
    liveTags.textContent = tagLabel(s?.next_set);
    analysing.hidden = !(s && s.analysing > 0 && !inSet);
    missed.hidden = !s?.recording?.file;
    if (inSet) drawTrail(trailCanvas, store.trail);
    alerts.update();
  };

  const offs = [
    store.on("status", onStatus),
    store.on("connection", () => onStatus(store.status)),
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
    next.destroy();
  };
}
