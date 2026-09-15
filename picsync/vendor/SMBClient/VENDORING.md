# SMBClient vendoring record

- Upstream: https://github.com/kishikawakatsumi/SMBClient
- Release: 0.3.1
- Commit: e636c2b2458930770932a36d311ec9d478575b90
- Retrieved: 2026-07-19
- Source tree SHA-256: 52e44d249220c53ade094bc5febe28ff070d5c92a421af46a85ca5eecb89cb6a
- License: MIT, copied in `LICENSE`.

The snapshot is resolved only from this local directory; builds do not contact a package registry. The SHA-256 above identifies the original source snapshot, not the locally patched tree.

Local transfer-reliability patches:

- File-handle uploads check short writes and close SMB handles on failure.
- File-handle uploads accept a resume offset. Existing files are opened without truncation, their length must match the requested offset, and concurrent writers/deleters are excluded while the handle is open. PicSync verifies the remote prefix before using this API.
- Upload progress callbacks can throw to checkpoint a paused transfer, and upload loops check task cancellation.
- Each SMB request has a 30-second deadline. Expiry cancels the underlying connection rather than leaving workers waiting indefinitely.
