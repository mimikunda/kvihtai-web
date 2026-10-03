// The station itself: turning it off properly, how it is doing, what went
// wrong and its logs, the recordings on its card, and what it runs on.
//
// The Pi used to be switched off by pulling the plug, which can damage the
// memory card and loses the last of the recording. Shut down here instead.

import { api, problem, type Boot, type PowerAction, type Segment, type Status, type SystemInfo } from "../api";
import { h, icons } from "../dom";
import { bytes, dateTime, duration } from "../format";
import { store } from "../store";
import { confirmSheet, toast } from "../ui";
import { alertBox } from "./alerts";

const PROBLEM = /\b(WARN|WARNING|ERROR|CRITICAL|Traceback|Exception|failed|killed|oom-kill|undervoltage)\b/i;

function fact(label: string): [HTMLElement, HTMLElement] {
  const value = h("b", {}, "–");
  return [h("div", {}, h("span", {}, label), value), value];
}

function card(title: string, ...body: (Node | null)[]): { el: HTMLElement; head: HTMLElement } {
  const head = h("div", { class: "card-head" }, h("h2", {}, title));
  return { el: h("section", { class: "card" }, head, ...body), head };
}

// --- power ---------------------------------------------------------------------------------

const POWER: Record<PowerAction, { label: string; title: string; text: string[]; yes: string; danger: boolean }> = {
  shutdown: {
    label: "Shut down",
    title: "Shut the Pi down?",
    text: [
      "The recording is closed properly and the Pi turns itself off. Unplug it once this page says so.",
      "To start it again, unplug it and plug it back in.",
    ],
    yes: "Shut down",
    danger: true,
  },
  reboot: {
    label: "Reboot",
    title: "Reboot the Pi?",
    text: ["The Pi starts again and the station is back in about a minute."],
    yes: "Reboot",
    danger: false,
  },
  restart: {
    label: "Restart station",
    title: "Restart the station?",
    text: ["The camera and the station start again, in about ten seconds. Try it when the station seems stuck."],
    yes: "Restart",
    danger: false,
  },
};

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

async function answers(): Promise<boolean> {
  try {
    await api.health();
    return true;
  } catch {
    return false;
  }
}

// Over the whole page while the station goes off and, for a restart, comes back.
async function powerOverlay(action: PowerAction): Promise<void> {
  const mark = h("div", { class: "power-mark" }, h("span", { class: "spinner big" }));
  const title = h("h2", {});
  const text = h("p", {});
  const done = h("button", { class: "btn", type: "button", hidden: true }, "Close");
  const overlay = h("div", { class: "power-overlay", role: "alertdialog", "aria-live": "assertive" }, mark, title, text, done);
  done.addEventListener("click", () => overlay.remove());
  document.body.append(overlay);
  const say = (t: string, body: string) => {
    title.textContent = t;
    text.textContent = body;
  };
  const finish = (ok: boolean, t: string, body: string) => {
    mark.innerHTML = ok ? icons.check : icons.warning;
    mark.className = `power-mark ${ok ? "good" : "bad"}`;
    say(t, body);
    done.hidden = false;
  };

  say(
    action === "shutdown" ? "Shutting down…" : action === "reboot" ? "Rebooting…" : "Restarting the station…",
    action === "shutdown" ? "Closing the recording and stopping the camera. Do not unplug the Pi yet." : "Stopping the camera…",
  );
  // gone: two checks in a row without an answer
  let misses = 0;
  const started = performance.now();
  while (misses < 2) {
    await wait(1000);
    misses = (await answers()) ? 0 : misses + 1;
    if (performance.now() - started > 60000) {
      finish(false, "The station is still running", "It did not stop within a minute. Look at the log on this page for why.");
      return;
    }
  }

  if (action === "shutdown") {
    // the station stops before the Pi does; the Pi needs a few seconds more
    for (let s = 12; s > 0; s--) {
      say("Almost off…", `The station has stopped. The Pi turns itself off in about ${s} s.`);
      await wait(1000);
    }
    finish(true, "You can unplug the Pi now", "If its green light still flashes, wait until it stops. To start it again, plug it back in.");
    return;
  }

  say(action === "reboot" ? "Rebooting…" : "Restarting the station…", "Waiting for it to come back…");
  const back = performance.now();
  while (!(await answers())) {
    await wait(2000);
    if (performance.now() - back > (action === "reboot" ? 180000 : 60000)) {
      finish(
        false,
        "The station has not come back",
        "If the phone has left the station's Wi-Fi, join it again. If it still does not come back, unplug the Pi and plug it back in.",
      );
      return;
    }
  }
  if (action === "reboot") {
    location.reload();
    return;
  }
  overlay.remove();
  toast("The station is running again", "good");
}

async function askPower(action: PowerAction): Promise<void> {
  const p = POWER[action];
  const s = store.status;
  const text = [...p.text];
  if (s?.state === "set") text.unshift("A set is being followed right now. It will be lost.");
  else if (s && s.analysing > 0) text.unshift("A set is still being analysed. It will be lost.");
  if (!(await confirmSheet(p.title, text, p.yes, p.danger))) return;
  try {
    await api.power(action);
  } catch (e) {
    toast(problem(e), "bad", 6000);
    return;
  }
  await powerOverlay(action);
}

function powerCard(): { el: HTMLElement; show: (info: SystemInfo) => void } {
  const buttons = (["shutdown", "reboot", "restart"] as PowerAction[]).map((a) =>
    h("button", { class: `btn ${a === "shutdown" ? "danger" : ""}`, type: "button", html: `${a === "shutdown" ? icons.power : icons.rotRight} ${POWER[a].label}` }),
  );
  buttons.forEach((b, i) => b.addEventListener("click", () => void askPower((["shutdown", "reboot", "restart"] as PowerAction[])[i])));
  const why = h("p", { class: "footnote", hidden: true });
  const { el } = card(
    "Power",
    h("p", { class: "step-text" }, "Shut the Pi down here before unplugging it. Pulling the plug can damage its memory card and loses the end of the recording."),
    h("div", { class: "row power-row" }, ...buttons),
    why,
  );
  return {
    el,
    show(info) {
      const reasons = new Set<string>();
      (["shutdown", "reboot", "restart"] as PowerAction[]).forEach((a, i) => {
        buttons[i].disabled = !info.power[a];
        const r = info.power.why[a];
        if (r) reasons.add(r);
      });
      why.hidden = reasons.size === 0;
      why.textContent = [...reasons].join(" ");
    },
  };
}

// --- how it is doing -----------------------------------------------------------------------

function factsCard(): { el: HTMLElement; show: (s: Status) => void } {
  const [stateFact, state] = fact("State");
  const [fpsFact, fps] = fact("Frame rate");
  const [tempFact, temp] = fact("Temperature");
  const [powerFact, power] = fact("Power supply");
  const [recFact, rec] = fact("Recording");
  const [freeFact, free] = fact("Free space");
  const [memFact, mem] = fact("Memory free");
  const [loadFact, load] = fact("Load");
  const [clockFact, clock] = fact("Station clock");
  const [upFact, up] = fact("Station running for");
  const { el } = card(
    "Station",
    h("div", { class: "facts" }, stateFact, fpsFact, tempFact, powerFact, recFact, freeFact, memFact, loadFact, clockFact, upFact),
  );
  return {
    el,
    show(s) {
      state.textContent = s.error ? `${s.state}: ${s.error}` : s.state;
      fps.textContent = `${s.fps.toFixed(0)} fps${s.dropped >= 0.02 ? `, ${Math.round(100 * s.dropped)} % lost` : ""}`;
      fps.classList.toggle("bad", s.dropped >= 0.05 || (s.state === "watching" && s.fps < 1));
      const t = s.system.temp_c;
      temp.textContent = t === undefined ? "–" : `${t.toFixed(0)} °C${s.system.throttled_now ? ", slowed down" : ""}`;
      temp.classList.toggle("bad", (t ?? 0) >= 80 || !!s.system.throttled_now);
      power.textContent = s.system.undervoltage ? "Too low now" : s.system.undervoltage_since_boot ? "Dipped since boot" : s.system.undervoltage === undefined ? "–" : "OK";
      power.classList.toggle("bad", !!s.system.undervoltage || !!s.system.undervoltage_since_boot);
      rec.textContent = s.recording ? (s.recording.error ? `error: ${s.recording.error}` : s.recording.file ?? "off") : "off";
      // the oldest recordings make room for new ones, so a nearly full card is normal
      free.textContent = s.recording ? `${s.recording.free_gb.toFixed(0)} GB` : "–";
      const m = s.system.mem_available_mb;
      mem.textContent = m == null ? "–" : `${m} MB of ${s.system.mem_total_mb}`;
      mem.classList.toggle("bad", m != null && !!s.system.mem_total_mb && m / s.system.mem_total_mb < 0.06);
      load.textContent = s.system.load == null ? "–" : s.system.load.toFixed(1);
      clock.textContent = new Date(s.clock.now).toLocaleString([], { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
      up.textContent = duration(s.uptime_s);
    },
  };
}

// --- what went wrong -----------------------------------------------------------------------

const KINDS: Record<string, string> = {
  power: "power cut",
  crash: "crash",
  camera: "camera",
  analysis: "analysis",
  undervoltage: "power supply",
  heat: "heat",
  storage: "storage",
};

function problemsCard(): { el: HTMLElement; load: () => Promise<void> } {
  const list = h("div", { class: "incidents" });
  const clear = h("button", { class: "btn small", type: "button" }, "Clear");
  const download = h("a", { class: "btn", href: api.diagnosticsUrl, download: "", html: `${icons.download} Download diagnostics` });
  const { el, head } = card(
    "Problems",
    list,
    h("div", { class: "row", style: "margin-top:12px" }, download),
    h("p", { class: "footnote" }, "The diagnostics are one file with the logs, the journal of this boot and the one before, and the settings. Send it with a description of what happened."),
  );
  head.append(clear);
  const load = async () => {
    try {
      const incidents = (await api.incidents()).slice().reverse();
      clear.hidden = incidents.length === 0;
      list.replaceChildren(
        ...(incidents.length
          ? incidents.map((i) =>
              h(
                "div",
                { class: `incident ${i.kind ?? ""}` },
                h("div", { class: "incident-head" }, h("b", { class: "num" }, dateTime(i.at)), i.kind ? h("span", { class: "tag" }, KINDS[i.kind] ?? i.kind) : null),
                h("div", {}, i.what),
              ),
            )
          : [h("p", { class: "step-text" }, "Nothing has gone wrong.")]),
      );
    } catch (e) {
      list.replaceChildren(h("p", { class: "step-text" }, `Could not load them: ${problem(e)}`));
    }
  };
  clear.addEventListener("click", async () => {
    if (!(await confirmSheet("Clear the problems?", ["The list starts empty. The logs keep everything."], "Clear"))) return;
    try {
      await api.clearIncidents();
      await load();
    } catch (e) {
      toast(problem(e), "bad");
    }
  });
  return { el, load };
}

// --- logs ------------------------------------------------------------------------------------

type Source = "station" | "journal" | "kernel";

function logCard(): { el: HTMLElement; start: () => void; stop: () => void } {
  let source: Source = "station";
  let lines = 150;
  let timer: number | undefined;
  let alive = false;
  const seg = (["station", "journal", "kernel"] as Source[]).map((s) =>
    h("button", { class: "seg", type: "button", "aria-pressed": String(s === source) }, { station: "Station", journal: "Journal", kernel: "Kernel" }[s]),
  );
  const problemsOnly = h("input", { type: "checkbox" }) as HTMLInputElement;
  const boot = h("select", { class: "select", hidden: true, "aria-label": "Boot" }) as HTMLSelectElement;
  const refresh = h("button", { class: "btn small", type: "button" }, "Refresh");
  const out = h("div", { class: "log" });
  const more = h("button", { class: "btn small", type: "button" }, "Show more");
  const about = h("p", { class: "footnote" });
  const { el, head } = card(
    "Log",
    h("div", { class: "segs" }, ...seg),
    h("div", { class: "row log-controls" }, h("label", { class: "switch" }, problemsOnly, "Problems only"), boot),
    about,
    out,
    h("div", { class: "row", style: "margin-top:10px" }, more),
  );
  head.append(refresh);

  const ABOUT: Record<Source, string> = {
    station: "The station's own log, kept on the card across restarts and power cuts. Newest first.",
    journal: "Everything the station's service wrote, the camera library's messages included, from the system journal. Newest first.",
    kernel: "The Linux kernel's messages: the camera driver, power, memory and the SD card. Newest first.",
  };

  const show = (records: string[], note?: string | null) => {
    out.replaceChildren(
      ...(records.length
        ? records
            .slice()
            .reverse()
            .map((r) => h("pre", { class: PROBLEM.test(r) ? "problem" : "" }, r))
        : [h("pre", {}, note || "Nothing.")]),
    );
    if (note && records.length) out.prepend(h("pre", { class: "problem" }, note));
  };

  const load = async () => {
    window.clearTimeout(timer);
    about.textContent = ABOUT[source];
    boot.hidden = source === "station" || boot.options.length < 2;
    try {
      if (source === "station") {
        show((await api.stationLog(lines, problemsOnly.checked)).records);
      } else {
        const j = await api.journal(source === "journal" ? "station" : "kernel", +(boot.value || 0), lines, problemsOnly.checked);
        show(j.lines, j.available ? j.error : j.error || "The journal is not available here.");
      }
    } catch (e) {
      show([], `Could not load the log: ${problem(e)}`);
    }
    // the station's log changes as it runs; the journal is loaded when asked for
    if (alive && source === "station" && document.visibilityState === "visible") timer = window.setTimeout(load, 5000);
  };

  seg.forEach((b, i) =>
    b.addEventListener("click", () => {
      source = (["station", "journal", "kernel"] as Source[])[i];
      seg.forEach((x, j) => x.setAttribute("aria-pressed", String(i === j)));
      lines = 150;
      void load();
    }),
  );
  problemsOnly.addEventListener("change", () => void load());
  boot.addEventListener("change", () => void load());
  refresh.addEventListener("click", () => void load());
  more.addEventListener("click", () => {
    lines = Math.min(lines * 4, 5000);
    void load();
  });

  const loadBoots = async () => {
    let boots: Boot[] = [];
    try {
      boots = await api.boots();
    } catch {
      return;
    }
    boot.replaceChildren(
      ...(boots.length ? boots : [{ index: 0, id: "", first: null, last: null }]).map((b) =>
        h(
          "option",
          { value: String(b.index) },
          b.index === 0 ? `This boot${b.first ? `, since ${dateTime(b.first)}` : ""}` : `${b.first ? dateTime(b.first) : "?"} – ${b.last ? dateTime(b.last) : "?"}`,
        ),
      ),
    );
    boot.hidden = source === "station" || boot.options.length < 2;
  };

  return {
    el,
    start() {
      alive = true;
      void loadBoots();
      void load();
    },
    stop() {
      alive = false;
      window.clearTimeout(timer);
    },
  };
}

// --- recordings ------------------------------------------------------------------------------

function recordingsCard(): { el: HTMLElement; load: () => Promise<void> } {
  const list = h("div", { class: "recordings" });
  const total = h("span", { class: "when num" });
  const more = h("button", { class: "btn small", type: "button", hidden: true });
  let all = false;
  const { el, head } = card(
    "Recordings",
    h("p", { class: "step-text" }, "Everything the camera sees is recorded, in 5 minute pieces. The oldest are deleted when the card is nearly full; kept ones only when nothing else is left."),
    list,
    h("div", { class: "row", style: "margin-top:10px" }, more),
  );
  head.append(total);

  const row = (seg: Segment): HTMLElement => {
    const keep = h("button", { class: `btn small ${seg.keep ? "on" : ""}`, type: "button", "aria-pressed": String(!!seg.keep) }, seg.keep ? "Kept" : "Keep");
    keep.addEventListener("click", async () => {
      try {
        await api.keepRecording(seg.name, !seg.keep);
        await load();
      } catch (e) {
        toast(problem(e), "bad");
      }
    });
    const when = seg.started_at ? dateTime(seg.started_at) : seg.name.replace(".mp4", "");
    return h(
      "div",
      { class: "recording" },
      h(
        "div",
        { class: "recording-main" },
        h("b", { class: "num" }, when, seg.recording ? h("span", { class: "tag rec" }, "recording") : null),
        h("span", { class: "sub num" }, `${seg.duration_s ? duration(seg.duration_s) : "–"} · ${bytes(seg.bytes)}`),
        seg.keep ? h("span", { class: "sub keep" }, seg.keep) : null,
      ),
      keep,
      seg.recording ? null : h("a", { class: "btn small icon", href: api.recordingUrl(seg.name), download: seg.name, html: icons.download, "aria-label": "Download" }),
    );
  };

  const load = async () => {
    try {
      const r = await api.recordings();
      const segs = r.segments.slice().reverse();
      const kept = segs.filter((s) => s.keep).length;
      total.textContent = `${segs.length} · ${bytes(r.total_bytes)}${kept ? ` · ${kept} kept` : ""}`;
      const shown = all ? segs : segs.slice(0, 8);
      list.replaceChildren(...(shown.length ? shown.map(row) : [h("p", { class: "step-text" }, r.enabled ? "None yet." : "Nothing is recorded on this station.")]));
      more.hidden = segs.length <= 8;
      more.textContent = all ? "Show fewer" : `Show all ${segs.length}`;
    } catch (e) {
      list.replaceChildren(h("p", { class: "step-text" }, `Could not load them: ${problem(e)}`));
    }
  };
  more.addEventListener("click", () => {
    all = !all;
    void load();
  });
  return { el, load };
}

// --- what it runs on -------------------------------------------------------------------------

function aboutCard(): { el: HTMLElement; show: (info: SystemInfo) => void } {
  const facts = h("div", { class: "facts" });
  const { el } = card("About this station", facts);
  return {
    el,
    show(info) {
      const net = info.network;
      const where = net.hotspot
        ? "its own hotspot"
        : net.wifi
          ? `Wi-Fi ${net.wifi}`
          : "no Wi-Fi";
      const addresses = net.addresses.map((a) => a.address).join(", ") || "–";
      const t = info.throttled?.since_boot;
      const trouble = t ? Object.entries(t).filter(([, v]) => v).map(([k]) => k.replace("_", " ")) : [];
      const rows: [string, string, boolean?][] = [
        ["Computer", info.model],
        ["System", info.os],
        ["Software", info.version ?? "unknown"],
        ["Network", where],
        ["Address", addresses],
        ["Pi running for", duration(info.booted_s)],
        ["Memory", info.memory ? `${info.memory.available_mb} MB free of ${info.memory.total_mb}` : "–"],
        ["Card", info.disk ? `${info.disk.free_gb} GB free of ${info.disk.total_gb}` : "–"],
        ["Recordings", bytes(info.storage.recordings_bytes)],
        ["Sets", bytes(info.storage.sets_bytes)],
        ["Since boot", info.throttled ? (trouble.length ? trouble.join(", ") : "no power or heat trouble") : "–", trouble.length > 0],
        ["Name", info.hostname],
      ];
      facts.replaceChildren(
        ...rows.map(([label, value, bad]) => h("div", {}, h("span", {}, label), h("b", { class: bad ? "bad" : "" }, value))),
      );
    },
  };
}

// --- the view --------------------------------------------------------------------------------

export function stationView(root: HTMLElement): () => void {
  const alerts = alertBox();
  const power = powerCard();
  const facts = factsCard();
  const problems = problemsCard();
  const log = logCard();
  const recordings = recordingsCard();
  const about = aboutCard();
  root.append(alerts.el, power.el, facts.el, problems.el, log.el, recordings.el, about.el);

  const loadInfo = async () => {
    try {
      const info = await api.system();
      power.show(info);
      about.show(info);
    } catch (e) {
      toast(`Could not ask the station about itself: ${problem(e)}`, "bad");
    }
  };

  let incidents = -1;
  const onStatus = (s: Status | null) => {
    alerts.update();
    if (!s) return;
    facts.show(s);
    // a new problem shows up without reloading
    const n = s.incidents?.length ?? 0;
    const last = s.incidents?.[n - 1]?.at;
    const key = n * 1e13 + (last ? new Date(last).getTime() : 0);
    if (incidents !== -1 && key !== incidents) void problems.load();
    incidents = key;
  };
  const offs = [store.on("status", onStatus), store.on("connection", () => onStatus(store.status))];
  onStatus(store.status);
  void loadInfo();
  void problems.load();
  void recordings.load();
  log.start();
  const slow = window.setInterval(() => void recordings.load(), 30000);

  return () => {
    offs.forEach((off) => off());
    log.stop();
    window.clearInterval(slow);
  };
}
