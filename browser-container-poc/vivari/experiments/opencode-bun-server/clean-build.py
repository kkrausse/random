#!/usr/bin/env python3
"""One offline build from a clean pin and a copied installed image (macOS)."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

PIN = "d7a7256bb6b0952f486c95718cfbf460b1570a56"
LOCK = "b6ebc10fd743b192bf81437c0e95a89b850daffa6cfe9de0ba6491c13f1c3764"
experiment = Path(__file__).resolve().parent
host = experiment.parent.parent
original = host / ".runtime/opencode-v2-source"
root = Path(tempfile.mkdtemp(prefix="clean-build.", dir=
    "/private/var/folders/t_/x48jtnps7n5_0g_pt9xpvbg00000gn/T/opencode"))
source = root / ".runtime/opencode-v2-source"
work = root / "experiments/opencode-bun-server"
output = root / ".runtime/opencode-bun-server"
receipt_path = root / "receipt.json"
started = time.time()
receipt = {"root": str(root), "startedUnix": started, "source": str(source),
    "experiment": str(work), "output": str(output), "dependencyMode":
    "offline reused installed image; macOS cp -cR -P; no install or native scripts",
    "packageIntegrityClaim": False, "buildAttempts": 0}


def run(*args, cwd=None):
    return subprocess.check_output(args, cwd=cwd, text=True).strip()


def sha(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def state(path):
    return {"head": run("git", "rev-parse", "HEAD", cwd=path),
        "tree": run("git", "rev-parse", "HEAD^{tree}", cwd=path),
        "status": run("git", "status", "--porcelain", "--untracked-files=all", cwd=path),
        "lockSha256": sha(path / "bun.lock"),
        "diffSha256": hashlib.sha256(subprocess.check_output(
            ["git", "diff", "HEAD", "--binary"], cwd=path)).hexdigest()}


def files(path):
    return {str(p.relative_to(path)): {"bytes": p.stat().st_size, "sha256": sha(p)}
        for p in sorted(path.rglob("*")) if p.is_file()} if path.exists() else {}


def links(path):
    for base, dirs, names in os.walk(path, followlinks=False):
        dirs[:] = sorted(d for d in dirs if d != ".git")
        for name in sorted(dirs + names):
            p = Path(base) / name
            if p.is_symlink():
                yield p


try:
    print(root, flush=True)
    receipt["originalBefore"] = state(original)
    assert receipt["originalBefore"]["head"] == PIN
    assert receipt["originalBefore"]["lockSha256"] == LOCK
    receipt["acceptedBefore"] = files(host / ".runtime/opencode-bun-server")
    source.parent.mkdir(parents=True)
    run("git", "worktree", "add", "--detach", str(source), PIN, cwd=original)
    receipt["sourceBefore"] = state(source)
    assert receipt["sourceBefore"]["status"] == ""
    assert receipt["sourceBefore"]["lockSha256"] == LOCK
    work.mkdir(parents=True)
    receipt["recipe"] = {}
    for name in ("server.ts", "build.ts", "package.json"):
        shutil.copy2(experiment / name, work / name)
        receipt["recipe"][name] = sha(work / name)
        assert sha(experiment / name) == receipt["recipe"][name]
    dep_roots = []
    for base, dirs, _ in os.walk(original):
        dirs[:] = sorted(d for d in dirs if d != ".git")
        if "node_modules" in dirs:
            dep_roots.append(Path(base) / "node_modules")
            dirs.remove("node_modules")
    receipt["dependencyRoots"] = [str(p.relative_to(original)) for p in dep_roots]
    copy_start = time.time()
    for dep in dep_roots:
        dest = source / dep.relative_to(original)
        dest.parent.mkdir(parents=True, exist_ok=True)
        assert not dest.exists()
        subprocess.run(["/bin/cp", "-cR", "-P", str(dep), str(dest)], check=True)
    receipt["copySeconds"] = time.time() - copy_start
    (work / "node_modules/@opencode-ai").mkdir(parents=True)
    (work / "node_modules/@opencode-ai/cli").symlink_to(source / "packages/cli")
    (work / "node_modules/effect").symlink_to(source / "packages/cli/node_modules/effect")
    manifest = []
    failures = []
    for base in (source, work / "node_modules"):
        for p in links(base):
            item = {"path": str(p.relative_to(root)), "target": os.readlink(p)}
            try:
                resolved = p.resolve(strict=True)
                item["resolved"] = str(resolved)
                if not resolved.is_relative_to(source):
                    failures.append(item)
            except (OSError, RuntimeError) as error:
                item["error"] = str(error)
                failures.append(item)
            manifest.append(item)
    link_path = root / "symlinks.json"
    link_path.write_text(json.dumps(manifest, indent=2) + "\n")
    receipt["symlinkAudit"] = {"count": len(manifest), "failures": failures,
        "manifest": str(link_path), "sha256": sha(link_path)}
    assert not failures, f"Symlink isolation blocker: {len(failures)} links; see receipt"
    # Hash copied regular dependency files; record local image identity, not registry integrity.
    content_path = root / "dependency-content.jsonl"
    count = total = 0
    with content_path.open("w") as stream:
        for dep in dep_roots:
            dest = source / dep.relative_to(original)
            for base, dirs, names in os.walk(dest, followlinks=False):
                dirs.sort()
                for name in sorted(names):
                    p = Path(base) / name
                    if p.is_symlink() or not p.is_file():
                        continue
                    size = p.stat().st_size
                    stream.write(json.dumps({"path": str(p.relative_to(source)),
                        "bytes": size, "sha256": sha(p)}) + "\n")
                    count += 1
                    total += size
    receipt["dependencyContent"] = {"manifest": str(content_path),
        "sha256": sha(content_path), "files": count, "bytes": total,
        "scope": "copied regular files only; no registry or original-image hash comparison"}
    bun = shutil.which("bun")
    receipt["builder"] = {"path": bun, "realpath": os.path.realpath(bun),
        "sha256": sha(bun), "version": run(bun, "--version"),
        "revision": run(bun, "--revision"), "upstreamPackageManager":
        json.loads((source / "package.json").read_text()).get("packageManager")}
    assert receipt["builder"]["revision"] == "1.4.0+34cbb9a40"
    receipt["command"] = [bun, "run", "build"]
    receipt["cwd"] = str(work)
    receipt["buildAttempts"] = 1
    build_start = time.time()
    with (root / "build.log").open("w") as log:
        result = subprocess.run(receipt["command"], cwd=work, stdout=log,
            stderr=subprocess.STDOUT, timeout=180)
    receipt["buildSeconds"] = time.time() - build_start
    receipt["exitCode"] = result.returncode
    receipt["outputs"] = files(output)
    old_js = (host / ".runtime/opencode-bun-server/server.js").read_bytes()
    new_js = (output / "server.js").read_bytes()
    receipt["acceptedComparison"] = {
        "rawJsEqual": old_js == new_js,
        "oldSourcePathOccurrences": old_js.count(str(original).encode()),
        "newSourcePathOccurrences": new_js.count(str(source).encode()),
        "equalAfterInMemorySourcePrefixReplacement":
            old_js.replace(str(original).encode(), b"<SOURCE>") ==
            new_js.replace(str(source).encode(), b"<SOURCE>"),
        "limitation": "Diagnostic comparison only; embedded runtime paths may affect behavior. Emitted files untouched; no runtime equivalence claim."}
    receipt["assetCopies"] = []
    for line in (root / "build.log").read_text().splitlines():
        if not line.startswith("{"):
            continue
        item = json.loads(line)
        if item.get("checkpoint") == "OPENCODE_BUILD_ASSET_COPY":
            item["sourceSha256"] = sha(item["source"])
            item["outputSha256"] = sha(item["path"])
            assert item["sourceSha256"] == item["outputSha256"]
            receipt["assetCopies"].append(item)
    receipt["buildPolicy"] = "Exact copied recipe: Node target, published jsonc-parser ESM selection, three original WASM copies; no additional rewrites"
    assert result.returncode == 0
    receipt["result"] = "BUILD_PASS"
except Exception as error:
    receipt["result"] = "BLOCKED"
    receipt["error"] = repr(error)
finally:
    receipt["originalAfter"] = state(original)
    if (source / ".git").exists():
        receipt["sourceAfter"] = state(source)
    receipt["acceptedAfter"] = files(host / ".runtime/opencode-bun-server")
    receipt["originalPreserved"] = receipt.get("originalBefore") == receipt["originalAfter"]
    receipt["acceptedPreserved"] = receipt.get("acceptedBefore") == receipt["acceptedAfter"]
    receipt["cleanSourcePreserved"] = receipt.get("sourceBefore") == receipt.get("sourceAfter")
    receipt["recipePreserved"] = all(sha(work / name) == digest == sha(experiment / name)
        for name, digest in receipt.get("recipe", {}).items())
    if receipt["result"] == "BUILD_PASS" and not all(receipt[key] for key in
            ("originalPreserved", "acceptedPreserved", "cleanSourcePreserved", "recipePreserved")):
        receipt["result"] = "BLOCKED"
        receipt["error"] = "Post-build preservation check failed"
    receipt["elapsedSeconds"] = time.time() - started
    receipt_path.write_text(json.dumps(receipt, indent=2) + "\n")
    print(f"{receipt['result']}: {receipt_path}", flush=True)
    if receipt["result"] != "BUILD_PASS":
        raise SystemExit(1)
