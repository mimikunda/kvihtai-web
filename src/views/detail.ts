// One set from the history.

import { api, problem } from "../api";
import { h, icons } from "../dom";
import { store } from "../store";
import { confirmSheet, toast } from "../ui";
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
          const yes = await confirmSheet("Delete this set?", ["Its results and its video are deleted. It cannot be brought back."], "Delete", true);
          if (!yes) return;
          try {
            await api.deleteSet(id);
          } catch (e) {
            toast(`Not deleted: ${problem(e)}`, "bad");
            return;
          }
          store.forgetLatest(id);
          location.hash = "#/history";
        },
      });
      card = setCard(result, "Set", h("div", { class: "row", style: "margin-top:14px" }, remove));
      slot.append(card.el);
    })
    .catch((e) => slot.append(h("div", { class: "banner" }, `This set could not be loaded: ${problem(e)}`)));

  return () => card?.destroy();
}
