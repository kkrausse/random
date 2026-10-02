// New session: pick a harness; it opens its own new chat in the launch directory.
import { TextAttributes } from "@opentui/core";
import { useKeyboard } from "@opentui/solid";
import { For, Show, createSignal } from "solid-js";
import type { Provider } from "./session.ts";
import { PROVIDERS } from "./store.ts";
import { colors, providerColor, spinner } from "./theme.ts";
import { shortPath } from "./format.ts";

export function NewSession(props: {
  active: () => boolean;
  initial?: Provider;
  /** Harnesses with an unused new chat ready to reopen. */
  cached: (h: Provider) => boolean;
  onCancel: () => void;
  onPick: (h: Provider, dir: string) => Promise<void>;
}) {
  const dir = process.env.AGENTDASH_CWD ?? process.cwd();
  const [index, setIndex] = createSignal(Math.max(0, PROVIDERS.indexOf(props.initial!)));
  const [starting, setStarting] = createSignal(false);
  const [error, setError] = createSignal("");

  async function start() {
    const h = PROVIDERS[index()]!;
    setStarting(true);
    setError("");
    try {
      await props.onPick(h, dir);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setStarting(false);
  }

  useKeyboard((key) => {
    if (!props.active() || key.defaultPrevented || starting()) return;
    if (key.name === "up" || key.name === "k") setIndex((i) => (i + PROVIDERS.length - 1) % PROVIDERS.length);
    else if (key.name === "down" || key.name === "j") setIndex((i) => (i + 1) % PROVIDERS.length);
    else if (key.name === "return" || key.name === "right" || key.name === "l") start();
    else if (key.name === "escape" || key.name === "left" || key.name === "q") props.onCancel();
  });

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.bg} paddingLeft={1}>
      <text height={1} fg={colors.text} attributes={TextAttributes.BOLD}>New session · {shortPath(dir)}</text>
      <box height={1} />
      <For each={PROVIDERS}>
        {(h, i) => (
          <box height={1} flexDirection="row" backgroundColor={index() === i() ? colors.surfaceRaised : colors.bg}>
            <text fg={index() === i() ? colors.selected : colors.dim}>{index() === i() ? "❯ " : "  "}</text>
            <text fg={providerColor(h)} attributes={index() === i() ? TextAttributes.BOLD : undefined}>{h}</text>
            <text fg={colors.dim}>{props.cached(h) ? "  · ready" : ""}</text>
          </box>
        )}
      </For>
      <box height={1} />
      <Show when={error()}>
        <text fg={colors.error}>{error()}</text>
      </Show>
      <box flexGrow={1} />
      <text height={1} fg={colors.dim} wrapMode="none">
        {starting() ? `${spinner()} starting ${PROVIDERS[index()]}…` : "↑↓ pick · ⏎ open a new chat · esc back"}
      </text>
    </box>
  );
}
