/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui"

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "commit-diff.open",
        title: "Open commit diff",
        group: "VCS",
        palette: true,
        slash: { name: "commit-diff" },
        run: () => {
          props.context.ui.toast.show({
            title: "Commit Diff Viewer",
            message: "Commit diff viewer is not implemented yet",
          })
        },
      },
    ],
  }))
  return null
}

export default Plugin.define({
  id: "commit.diff.viewer",
  setup(context) {
    // Keymap layers consume the host's Solid context and must be mounted.
    return context.ui.slot({ append: "app", render: () => <Commands context={context} /> })
  },
})
