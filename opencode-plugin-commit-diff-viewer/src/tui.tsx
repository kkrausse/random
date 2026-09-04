/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode-ai/plugin/tui"
import { execFile } from "node:child_process"

const ROUTE_MARKER = "commitDiffBase"
const MANUAL_REVISION = "__commit_diff_manual_revision__"
const COMMIT_LIMIT = 25

interface RecentCommit {
  hash: string
  shortHash: string
  subject: string
  author: string
  relativeDate: string
}

function recentCommits(directory: string): Promise<RecentCommit[]> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      [
        "log",
        `--max-count=${COMMIT_LIMIT}`,
        "--skip=1",
        "--date=relative",
        "--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ar",
      ],
      { cwd: directory, encoding: "utf8", timeout: 5_000, maxBuffer: 1024 * 1024 },
      (error, stdout) => {
        if (error) {
          reject(error)
          return
        }

        resolve(
          stdout
            .split("\n")
            .filter(Boolean)
            .flatMap((line) => {
              const [hash, shortHash, subject, author, relativeDate] = line.split("\x1f")
              return hash && shortHash && subject && author && relativeDate
                ? [{ hash, shortHash, subject, author, relativeDate }]
                : []
            }),
        )
      },
    )
  })
}

async function chooseBase(context: Plugin.Context) {
  let commits: RecentCommit[] = []
  try {
    commits = await recentCommits((context.location ?? context.data.location.default()).directory)
  } catch {
    context.ui.toast.show({
      message: "Could not load local commit history; enter a revision instead.",
      variant: "warning",
    })
  }

  if (commits.length > 0) {
    const selected = await context.ui.dialog.select({
      title: "Compare HEAD with commit",
      placeholder: "Search recent commits",
      options: [
        ...commits.map((commit) => ({
          title: `${commit.shortHash}  ${commit.subject}`,
          description: `${commit.relativeDate} by ${commit.author}`,
          value: commit.hash,
        })),
        {
          title: "Enter another revision…",
          description: "Commit SHA, branch, tag, or expression such as HEAD~3",
          value: MANUAL_REVISION,
        },
      ],
    })
    if (!selected) return
    if (selected !== MANUAL_REVISION) return selected
  }

  return (
    await context.ui.dialog.prompt({
      title: "Compare with commit",
      placeholder: "Commit SHA or revision (for example HEAD~3)",
    })
  )?.trim()
}

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
          const base = await chooseBase(props.context)
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
