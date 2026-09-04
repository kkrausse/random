/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui"

const ROUTE_MARKER = "commitDiffBase"

function Commands(props: { context: Plugin.Context }) {
  props.context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "commit-diff.open",
        title: "Compare HEAD with a commit",
        group: "VCS",
        palette: true,
        slash: { name: "commit-diff" },
        run: async () => {
          const base = (
            await props.context.ui.dialog.prompt({
              title: "Compare with commit",
              placeholder: "Commit SHA or revision (for example HEAD~3)",
            })
          )?.trim()
          if (!base) return

          const currentRoute = props.context.ui.router.current()
          const returnRoute =
            currentRoute.type === "home"
              ? { type: "home" as const }
              : currentRoute.type === "session"
                ? { type: "session" as const, sessionID: currentRoute.sessionID }
                : {
                    type: "plugin" as const,
                    id: currentRoute.id,
                    name: currentRoute.name,
                    ...(currentRoute.data ? { data: { ...currentRoute.data } } : {}),
                  }
          props.context.ui.router.navigate({
            type: "plugin",
            id: "opencode.diffs",
            name: "diff",
            data: {
              mode: "committed",
              [ROUTE_MARKER]: base,
              returnRoute,
            },
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
    const vcs = context.client.vcs
    const originalBase = vcs.base.bind(vcs)
    const originalDiff = vcs.diff.bind(vcs)

    const selectedBase = () => {
      const route = context.ui.router.current()
      if (route.type !== "plugin" || route.name !== "diff") return
      const base = route.data?.[ROUTE_MARKER]
      return typeof base === "string" && base.length > 0 ? base : undefined
    }

    vcs.base = async (...args) => {
      const base = selectedBase()
      if (!base) return originalBase(...args)

      const result = await originalBase(...args)
      return {
        ...result,
        data: {
          name: base,
          ref: base,
          source: "default" as const,
        },
      }
    }

    vcs.diff = async (input, options) => {
      const base = selectedBase()
      if (!base) return originalDiff(input, options)
      return originalDiff({ ...input, mode: "committed", base }, options)
    }

    // Keymap layers consume the host's Solid context and must be mounted.
    const unregister = context.ui.slot({ append: "app", render: () => <Commands context={context} /> })

    return () => {
      unregister()
      vcs.base = originalBase
      vcs.diff = originalDiff
    }
  },
})
