// Every set, newest first, grouped by day, and filtered by lift. For a lift
// with weights given, the speed of each set against its weight: the bar slows
// as the weight goes up, and a lifter in form moves the same weight faster.

import { api, type SetBrief } from "../api";
import { drawLoadVelocity, redrawOnResize } from "../charts";
import { h, icons } from "../dom";
import { best, clockTime, dayLabel, mps, tagLabel } from "../format";
import { store } from "../store";

const NONE = "\u0000none";          // the filter for sets nobody said anything about
const FILTER_KEY = "kvihtai.history.lift";

function row(set: SetBrief): HTMLElement {
  const top = best(set.rises);
  const max = Math.max(...set.rises.map((r) => r.mean_concentric_velocity_mps), 0.01);
  const reps = set.rises.length;
  const label = tagLabel(set.tags);
  const counts = `${reps} ${reps === 1 ? "rep" : "reps"} · ${mps(top?.mean_concentric_velocity_mps)} m/s`;
  return h(
    "a",
    { class: "set-row", href: `#/set/${encodeURIComponent(set.set_id)}` },
    h("span", { class: "time" }, clockTime(set.started_at)),
    h(
      "span",
      { class: "summary" },
      h("div", { class: "main num" }, label || counts),
      h(
        "div",
        { class: "sub" },
        `${label ? `${counts} best` : "best mean velocity"}${set.has_video ? " · video" : ""}${set.tags?.note ? " · note" : ""}`,
      ),
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

function remembered(): string | null {
  try {
    return localStorage.getItem(FILTER_KEY);
  } catch {
    return null;
  }
}

function remember(lift: string | null): void {
  try {
    if (lift === null) localStorage.removeItem(FILTER_KEY);
    else localStorage.setItem(FILTER_KEY, lift);
  } catch {
    // a private window: the filter is not remembered, which is fine
  }
}

export function historyView(root: HTMLElement): () => void {
  const filters = h("div", { class: "chips filters" });
  const exportLink = h("a", { class: "btn small", href: api.csvUrl, download: "", html: `${icons.download} CSV` });
  const canvas = h("canvas", { "aria-label": "Mean velocity against weight" });
  const chartNote = h("span", {});
  const chart = h(
    "section",
    { class: "card", hidden: true },
    h("div", { class: "card-head" }, h("h2", {}, "Speed and weight"), chartNote),
    h("div", { class: "chart lv" }, canvas),
    h("p", { class: "footnote" }, "Each dot is a set: its fastest rep's mean velocity at the weight given. Today's sets are orange."),
  );
  const list = h("div", { class: "controls" });
  root.append(h("div", { class: "history-top" }, filters, exportLink), chart, list);

  let sets: SetBrief[] = [];
  let lift: string | null = remembered();
  let shown: string | null | undefined;

  const chartPoints = (subset: SetBrief[]) => {
    const today = new Date().toDateString();
    return subset
      .filter((s) => s.tags?.weight_kg && s.rises.length)
      .map((s) => ({
        kg: s.tags!.weight_kg!,
        v: best(s.rises)!.mean_concentric_velocity_mps,
        recent: new Date(s.started_at).toDateString() === today,
      }));
  };
  const drawChart = () => {
    const subset = sets.filter((s) => s.tags?.lift === lift);
    drawLoadVelocity(canvas, chartPoints(subset));
  };

  const render = () => {
    // the lifts there are sets of, the most lifted first
    const counts = new Map<string, number>();
    let untagged = 0;
    for (const s of sets) {
      const l = s.tags?.lift;
      if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
      else untagged++;
    }
    const lifts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
    if (lift !== null && lift !== NONE && !counts.has(lift)) lift = null;
    const chip = (value: string | null, label: string) => {
      const b = h("button", { class: `chip ${lift === value ? "on" : ""}`, type: "button", "aria-pressed": String(lift === value) }, label);
      b.addEventListener("click", () => {
        lift = value;
        remember(lift);
        render();
      });
      return b;
    };
    filters.replaceChildren(
      ...(lifts.length ? [chip(null, "All"), ...lifts.map((l) => chip(l, l)), ...(untagged ? [chip(NONE, "Not given")] : [])] : []),
    );

    const subset = lift === null ? sets : sets.filter((s) => (lift === NONE ? !s.tags?.lift : s.tags?.lift === lift));
    const points = lift !== null && lift !== NONE ? chartPoints(subset) : [];
    chart.hidden = new Set(points.map((p) => p.kg)).size < 2;
    chartNote.textContent = chart.hidden ? "" : `${lift} · ${points.length} sets`;
    if (!chart.hidden) requestAnimationFrame(drawChart);

    list.replaceChildren();
    if (sets.length === 0) {
      list.append(h("section", { class: "card empty" }, h("strong", {}, "No sets yet"), "Sets you lift in front of the camera are kept here."));
      return;
    }
    const days = new Map<string, SetBrief[]>();
    for (const set of subset) {
      const label = dayLabel(set.started_at);
      if (!days.has(label)) days.set(label, []);
      days.get(label)!.push(set);
    }
    for (const [label, daySets] of days) {
      const reps = daySets.reduce((n, s) => n + s.rises.length, 0);
      list.append(
        h(
          "div",
          { class: "day" },
          h("span", {}, label),
          h("span", { class: "day-sum" }, `${daySets.length} ${daySets.length === 1 ? "set" : "sets"} · ${reps} reps`),
        ),
      );
      for (const set of daySets) list.append(row(set));
    }
  };

  const load = async () => {
    try {
      sets = await api.sets();
      render();
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
  const offResize = redrawOnResize(canvas, () => {
    if (!chart.hidden) drawChart();
  });
  shown = store.status?.last_set_id;
  void load();
  return () => {
    off();
    offResize();
  };
}
