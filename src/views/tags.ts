// Saying what a set was: the lift, the weight on the bar and a note. Said once
// for the next set, it is put on every set that ends from then on; said for a
// set afterwards, it changes only that one.

import { api, problem, type NextSet, type SetResult, type Tags } from "../api";
import { h } from "../dom";
import { kg, LIFTS } from "../format";
import { store } from "../store";
import { sheet, toast } from "../ui";

interface Picker<T> {
  el: HTMLElement;
  set(value: T): void;
}

// Chips for the usual lifts, and a field for any other.
export function liftPicker(onPick: (lift: string | null) => void): Picker<string | null> {
  let current: string | null = null;
  const other = h("input", { class: "text", type: "text", maxlength: "40", placeholder: "Another lift", hidden: true }) as HTMLInputElement;
  const chips = [...LIFTS, "Other"].map((name) =>
    h("button", { class: "chip", type: "button", "aria-pressed": "false" }, name),
  );
  const show = () => {
    const known = current !== null && LIFTS.includes(current);
    chips.forEach((c, i) => {
      const on = i < LIFTS.length ? c.textContent === current : current !== null && !known;
      c.setAttribute("aria-pressed", String(on));
      c.classList.toggle("on", on);
    });
    chips[chips.length - 1].textContent = current !== null && !known ? current : "Other";
  };
  chips.forEach((c, i) =>
    c.addEventListener("click", () => {
      if (i === LIFTS.length) {
        other.hidden = false;
        other.value = current !== null && !LIFTS.includes(current) ? current : "";
        other.focus();
        return;
      }
      current = current === LIFTS[i] ? null : LIFTS[i];
      other.hidden = true;
      show();
      onPick(current);
    }),
  );
  const commit = () => {
    const name = other.value.trim();
    other.hidden = true;
    if (!name) return;
    current = name;
    show();
    onPick(current);
  };
  other.addEventListener("change", commit);
  other.addEventListener("keydown", (e) => {
    if (e.key === "Enter") other.blur();
  });
  return {
    el: h("div", { class: "lifts" }, h("div", { class: "chips" }, ...chips), other),
    set(value) {
      current = value;
      show();
    },
  };
}

// The weight, in steps a lifter loads and by typing.
export function weightPicker(onChange: (kg: number | null) => void): Picker<number | null> {
  const input = h("input", {
    class: "weight-input num",
    type: "number",
    inputmode: "decimal",
    min: "0",
    max: "500",
    step: "0.5",
    placeholder: "–",
    "aria-label": "Weight in kg",
  }) as HTMLInputElement;
  const value = (): number | null => (input.value === "" || +input.value <= 0 ? null : +input.value);
  const step = (d: number) =>
    h("button", {
      class: "btn step-btn",
      type: "button",
      onclick: () => {
        const next = Math.max(0, Math.min(500, (value() ?? 0) + d));
        input.value = next > 0 ? String(+next.toFixed(2)) : "";
        onChange(value());
      },
    }, `${d > 0 ? "+" : "−"}${Math.abs(d)}`);
  input.addEventListener("change", () => onChange(value()));
  return {
    el: h("div", { class: "weight" }, step(-5), step(-1), h("label", { class: "weight-box" }, input, h("span", {}, "kg")), step(1), step(5)),
    set(v) {
      if (document.activeElement !== input) input.value = v == null ? "" : String(+v.toFixed(2));
    },
  };
}

// The card on Now: what the next set will be.
export function nextSetCard(): { el: HTMLElement; destroy: () => void } {
  let editedAt = 0;
  let timer: number | undefined;
  let wanted: NextSet = { lift: null, weight_kg: null };
  const send = () => {
    window.clearTimeout(timer);
    editedAt = performance.now();
    timer = window.setTimeout(async () => {
      try {
        wanted = await api.nextSet(wanted);
      } catch (e) {
        toast(`Not saved: ${problem(e)}`, "bad");
      }
    }, 400);
    summary.textContent = describe(wanted);
  };
  const lift = liftPicker((l) => {
    wanted = { ...wanted, lift: l };
    send();
  });
  const weight = weightPicker((w) => {
    wanted = { ...wanted, weight_kg: w };
    send();
  });
  const summary = h("span", { class: "when" });
  const el = h(
    "section",
    { class: "card next-set" },
    h("div", { class: "card-head" }, h("h2", {}, "Next set"), summary),
    lift.el,
    weight.el,
    h("p", { class: "footnote" }, "Every set that ends from now on is marked with this. Change it between sets; a set already lifted is changed on its own card."),
  );
  const show = () => {
    const n = store.status?.next_set;
    // the poll must not undo what is being typed
    if (!n || performance.now() - editedAt < 3000) return;
    wanted = { lift: n.lift, weight_kg: n.weight_kg };
    lift.set(n.lift);
    weight.set(n.weight_kg);
    summary.textContent = describe(n);
  };
  const off = store.on("status", show);
  show();
  return { el, destroy: () => (off(), window.clearTimeout(timer)) };
}

function describe(n: NextSet): string {
  return [n.lift, kg(n.weight_kg)].filter(Boolean).join(" · ") || "not said";
}

// A sheet to change what one set was. Calls back with the set as saved.
export function editTags(result: SetResult, saved: (r: SetResult) => void): void {
  const tags: Tags = { lift: null, weight_kg: null, note: null, ...(result.tags ?? {}) };
  const lift = liftPicker((l) => (tags.lift = l));
  const weight = weightPicker((w) => (tags.weight_kg = w));
  lift.set(tags.lift);
  weight.set(tags.weight_kg);
  const note = h("textarea", { class: "text", rows: "3", maxlength: "500", placeholder: "Note: how it felt, what to fix" }) as HTMLTextAreaElement;
  note.value = tags.note ?? "";
  sheet("What was this set?", [lift.el, weight.el, note], [
    { label: "Cancel" },
    {
      label: "Save",
      kind: "primary",
      run: async () => {
        try {
          saved(await api.tagSet(result.set_id, { ...tags, note: note.value.trim() || null }));
          toast("Saved", "good", 1500);
        } catch (e) {
          toast(`Not saved: ${problem(e)}`, "bad");
          return false;
        }
      },
    },
  ]);
}
