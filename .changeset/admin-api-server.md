---
'@pingpong-io/server': minor
---

Serve the admin API at `/admin/v1` when `PINGPONG_ADMIN_TOKEN` is set (at least 32 characters, sent as a bearer token): the server's status with the checks of `pingpong doctor`, and the projects, which it lists, shows, creates, changes, deletes and gives a new secret, showing a secret only once. Disabling or deleting a project through it disconnects the project's sockets. It shows each project's live channels and subscription counts, and what the server counted since it started: connections and their peak, connections refused by reason, messages published and their bytes, requests over the rate limit. Without the token, nothing changes. `pingpong doctor` now runs the same checks as the status, and says `secret key: PINGPONG_SECRET_KEY is not set` when the key is missing.
