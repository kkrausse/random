import { Plugin } from "@opencode-ai/plugin/tui"

export default Plugin.define({
  id: "commit.diff.viewer",
  setup(context) {
    const timer = setTimeout(() => {
      // OpenCode beta 18721 loads this plugin, but the documented keymap
      // registration below does not expose /commit-diff in a fresh TUI.
      // Registering synchronously or after this delay has the same result.
      // context.keymap.layer(() => ({
      //   mode: "global",
      //   commands: [
      //     {
      //       id: "commit-diff.open",
      //       title: "Open commit diff",
      //       slash: { name: "commit-diff" },
      //       run: () => {},
      //     },
      //   ],
      //   bindings: ["commit-diff.open"],
      // }))

      context.ui.toast.show({
        title: "Commit Diff Viewer",
        message: "Plugin loaded",
        variant: "success",
        duration: 10_000,
      })
    }, 1_500)

    return () => clearTimeout(timer)
  },
})
