# random

Personal experiments, tools, and small projects. Some are web apps; others are
scripts, skills, or explorations that do not need their own repository.

## Projects

- [`fieldcut/`](./fieldcut): A local-first video editor.
- [`timegrapher/`](./timegrapher): A browser-based mechanical watch timegrapher.
- [`workout-analyze/`](./workout-analyze): A Garmin workout analysis app.
- [`garmin-watch-face/`](./garmin-watch-face): A simple analog Garmin watch face.
- [`skills/`](./skills): Reusable agent skills.

Projects are intentionally added one at a time. Other directories in this
workspace are ignored until they are reviewed and explicitly imported.

## Importing another repository with history

From this repository's root, move the existing checkout out of the way and use
Git subtree without `--squash`:

```sh
git subtree add --prefix=<destination> <path-or-repository-url> <branch>
```

This creates an import commit while retaining the original commits in the
monorepo's history.
