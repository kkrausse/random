/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui"

function EmptyPromptBinding(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    priority: 100,
    commands: [
      {
        id: "claude-sessions.open",
        title: "Open sessions from an empty prompt",
        group: "Sessions",
        bind: "left",
        run: () => {
          const route = props.context.ui.router.current()
          if (route.type !== "home" && route.type !== "session") return false

          const editor = props.context.renderer.currentFocusedEditor
          if (!editor || editor.plainText !== "") return false

          props.context.keymap.dispatch("session.list")
        },
      },
    ],
  }))

  return null
}

export default Plugin.define({
  id: "claude.sessions",
  setup(context) {
    return context.ui.slot({
      append: "app",
      render: () => <EmptyPromptBinding context={context} />,
    })
  },
})
