// Every set, newest first, grouped by day.

import { api, type SetBrief } from "../api";
import { h } from "../dom";
import { best, clockTime, dayLabel, mps } from "../format";
import { store } from "../store";

function row(set: SetBrief): HTMLElement {
  const top = best(set.rises);
  const max = Math.max(...set.rises.map((r) => r.mean_concentric_velocity_mps), 0.01);
  const reps = set.rises.length;
  return h(
    "a",
    { class: "set-row", href: `#/set/${encodeURIComponent(set.set_id)}` },
    h("span", { class: "time" }, clockTime(set.started_at)),
    h(
      "span",
      { class: "summary" },
      h("div", { class: "main num" }, `${reps} ${reps === 1 ? "rep" : "reps"} · ${mps(top?.mean_concentric_velocity_mps)} m/s`),
      h("div", { class: "sub" }, `best mean velocity${set.has_video ? " · video" : ""}`),
    ),
    h(
      "span",
      { class: "spark", "aria-hidden": "true" },
      ...set.rises.slice(0, 12).map((r) =>
        h("i", { style: `height:${Math.max(12, (100 * r.mean_concentric_velocity_mps) / max)}%` }),
      ),
    ),
  );
}

export function historyView(root: HTMLElement): () => void {
  const list = h("div", { class: "controls" });
  root.append(list);
  let shown: string | null | undefined;

  const load = async () => {
    try {
      const sets = await api.sets();
      list.replaceChildren();
      if (sets.length === 0) {
        list.append(h("section", { class: "card empty" }, h("strong", {}, "No sets yet"), "Sets you lift in front of the camera are kept here."));
        return;
      }
      let day = "";
      for (const set of sets) {
        const label = dayLabel(set.started_at);
        if (label !== day) {
          list.append(h("div", { class: "day" }, label));
          day = label;
        }
        list.append(row(set));
      }
    } catch {
      list.replaceChildren(h("div", { class: "banner" }, "Could not load the sets."));
    }
  };

  const off = store.on("status", (s) => {
    if (s && s.last_set_id !== shown) {
      shown = s.last_set_id;
      void load();
    }
  });
  shown = store.status?.last_set_id;
  void load();
  return off;
}
