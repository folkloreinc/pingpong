# @pingpong-io/protocol

## 0.2.0

### Minor Changes

- 6e59d6c: Describe the admin API (`/admin/v1`), for a server's operators and its dashboard: the server's status, and the projects (list, create, change, delete, rotate a secret), with their live channels and the stats the server counted since it started. It needs the server's admin token as a bearer token (`adminToken`). New types: `AdminProject`, `AdminProjectList`, `AdminProjectCreate`, `AdminProjectCreated`, `AdminProjectPatch`, `AdminSecretRotation`, `AdminProjectSecret`, `AdminChannelList`, `ProjectStats`, `ServerStatus`, `ServerCheck`, `Limits`, `OwnLimits`, `LimitsPatch`, `ProjectName`, `ProjectSecret`.

## 0.1.0

### Minor Changes

- 52a1097: First draft of protocol v1: the HTTP API to publish messages, read a channel's subscription count and manage the project's origins; the payloads of the Socket.IO events; generated types, a validator, and helpers to sign and check API requests and private channels.
