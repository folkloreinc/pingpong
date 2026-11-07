---
'@pingpong-io/server': patch
---

A connection to a project that doesn't exist no longer leaves a Socket.IO namespace behind, and the project cache keeps at most 10,000 entries by id and as many by key, dropping expired ones first.
