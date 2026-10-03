// Messages and questions that sit over the page: a toast that goes by itself,
// and a sheet from the bottom of the screen, where a thumb can reach it.

import { h } from "./dom";

let toastBox: HTMLElement | null = null;

export function toast(text: string, level: "good" | "bad" | "info" = "info", ms = 4000): void {
  if (!toastBox) {
    toastBox = h("div", { class: "toasts", role: "status", "aria-live": "polite" });
    document.body.append(toastBox);
  }
  const el = h("div", { class: `toast ${level}` }, text);
  toastBox.append(el);
  window.setTimeout(() => {
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 250);
  }, ms);
}

export interface SheetAction {
  label: string;
  kind?: "primary" | "danger" | "";
  // return false to keep the sheet open
  run?: () => boolean | void | Promise<boolean | void>;
}

// A sheet with a title, any content, and buttons along the bottom. Closed by
// a button, a tap outside it, or Escape; the returned function closes it too.
// onClose is called however it closes.
export function sheet(
  title: string,
  body: (Node | string)[],
  actions: SheetAction[],
  onClose?: () => void,
): () => void {
  const buttons = actions.map((a) => h("button", { class: `btn ${a.kind ?? ""}`, type: "button" }, a.label));
  const panel = h(
    "div",
    { class: "sheet", role: "dialog", "aria-modal": "true", "aria-label": title },
    h("h2", {}, title),
    ...body,
    h("div", { class: "sheet-actions" }, ...buttons),
  );
  const backdrop = h("div", { class: "backdrop" }, panel);
  let open = true;
  const close = () => {
    if (!open) return;
    open = false;
    backdrop.remove();
    document.removeEventListener("keydown", onKey);
    document.body.classList.remove("no-scroll");
    onClose?.();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  buttons.forEach((b, i) =>
    b.addEventListener("click", async () => {
      const run = actions[i].run;
      if (!run) return close();
      buttons.forEach((x) => (x.disabled = true));
      try {
        if ((await run()) !== false) close();
      } finally {
        buttons.forEach((x) => (x.disabled = false));
      }
    }),
  );
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.classList.add("no-scroll");
  document.body.append(backdrop);
  return close;
}

// Yes or no; a tap outside the sheet or Escape is a no.
export function confirmSheet(title: string, text: (Node | string)[], yes: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answer = false;
    sheet(
      title,
      text.map((t) => (typeof t === "string" ? h("p", { class: "sheet-text" }, t) : t)),
      [{ label: "Cancel" }, { label: yes, kind: danger ? "danger" : "primary", run: () => void (answer = true) }],
      () => resolve(answer),
    );
  });
}
