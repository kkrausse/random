import { Plugin } from "@opencode-ai/plugin/tui"

const ROUTE_MARKER = "commitDiffBase"

export default Plugin.define({
  id: "commit-diff-viewer",
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

    const unregister = context.ui.slot({
      append: "app",
      render: () => {
        context.keymap.layer(() => ({
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
                  await context.ui.dialog.prompt({
                    title: "Compare with commit",
                    placeholder: "Commit SHA or revision (for example HEAD~3)",
                  })
                )?.trim()
                if (!base) return

                const returnRoute = context.ui.router.current()
                context.ui.router.navigate({
                  type: "plugin",
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
      },
    })

    return () => {
      unregister()
      vcs.base = originalBase
      vcs.diff = originalDiff
    }
  },
})
