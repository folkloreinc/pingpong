---
'@pingpong-io/protocol': minor
---

Describe the admin API (`/admin/v1`), for a server's operators and its dashboard: the server's status, and the projects (list, create, change, delete, rotate a secret), with their live channels and the stats the server counted since it started. It needs the server's admin token as a bearer token (`adminToken`). New types: `AdminProject`, `AdminProjectList`, `AdminProjectCreate`, `AdminProjectCreated`, `AdminProjectPatch`, `AdminSecretRotation`, `AdminProjectSecret`, `AdminChannelList`, `ProjectStats`, `ServerStatus`, `ServerCheck`, `Limits`, `OwnLimits`, `LimitsPatch`, `ProjectName`, `ProjectSecret`.
