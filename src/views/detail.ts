// One set from the history.

import { api } from "../api";
import { h, icons } from "../dom";
import { store } from "../store";
import { setCard, type SetCard } from "./setCard";

export function detailView(root: HTMLElement, id: string): () => void {
  let card: SetCard | null = null;
  root.append(h("a", { class: "back", href: "#/history", html: `${icons.back} All sets` }));
  const slot = h("div");
  root.append(slot);

  api
    .set(id)
    .then((result) => {
      const remove = h("button", {
        class: "btn danger",
        type: "button",
        html: `${icons.trash} Delete set`,
        onclick: async () => {
          if (!confirm("Delete this set? It cannot be brought back.")) return;
          await api.deleteSet(id);
          store.forgetLatest(id);
          location.hash = "#/history";
        },
      });
      card = setCard(result, "Set", h("div", { class: "row", style: "margin-top:14px" }, remove));
      slot.append(card.el);
    })
    .catch(() => slot.append(h("div", { class: "banner" }, "This set could not be loaded.")));

  return () => card?.destroy();
}
