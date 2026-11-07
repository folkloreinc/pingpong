// Generated from schema/openapi.json by `npm run generate`. Do not edit.

export interface paths {
    "/v1/messages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publish a message
         * @description Sends one event to the subscribers of one or more channels of the project. Subscribers receive it as a `message` event (`SocketMessage`), once per channel they are subscribed to. Delivery is at most once, except that a client recovered after a short disconnection receives what it missed.
         */
        post: operations["publishMessage"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/messages/batch": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Publish several messages
         * @description Publishes up to 100 messages in one request, in order. The request is refused as a whole when one message is invalid or too large.
         */
        post: operations["publishMessages"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/channels/{channel}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The channel, URL-encoded. */
                channel: components["schemas"]["ChannelName"];
            };
            cookie?: never;
        };
        /**
         * Read a channel
         * @description Returns how many sockets are subscribed to the channel right now. A channel nobody is subscribed to is not occupied: there is no error for an unknown channel.
         */
        get: operations["getChannel"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/origins": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the allowed origins */
        get: operations["getOrigins"];
        /**
         * Replace the allowed origins
         * @description Replaces the list of origins clients may connect from, for example when the application adds a domain. Sockets already connected stay connected.
         */
        put: operations["replaceOrigins"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Check the server
         * @description Answers when the server is up and its database and Redis (when configured) answer. For load balancers and monitoring.
         */
        get: operations["getHealth"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/status": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read the server's status
         * @description The server's version, the checks of `pingpong doctor`, and its live connections and channels. Answers 200 even when a check fails: `healthy` says whether they all pass.
         */
        get: operations["adminGetStatus"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/projects": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List the projects */
        get: operations["adminListProjects"];
        put?: never;
        /**
         * Create a project
         * @description Creates a project with a new key and a new secret. The secret is in this response only: put it in the application's environment.
         */
        post: operations["adminCreateProject"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/projects/{project}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
            };
            cookie?: never;
        };
        /** Read a project */
        get: operations["adminGetProject"];
        put?: never;
        post?: never;
        /**
         * Delete a project
         * @description Deletes the project and disconnects its sockets, on every server. Its key and secret stop working.
         */
        delete: operations["adminDeleteProject"];
        options?: never;
        head?: never;
        /**
         * Change a project
         * @description Changes what the request has, and leaves the rest. `origins` replaces the list. A limit set to `null` goes back to the server's default. Disabling a project disconnects its sockets, on every server, and refuses new ones.
         */
        patch: operations["adminUpdateProject"];
        trace?: never;
    };
    "/admin/v1/projects/{project}/rotate-secret": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
            };
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rotate a project's secret
         * @description Gives the project a new secret, for API requests and private channels. The previous one stays valid for the grace period, so the application can deploy the new one first. A second rotation within the grace period drops the secret before the current one.
         */
        post: operations["adminRotateProjectSecret"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/projects/{project}/channels": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
            };
            cookie?: never;
        };
        /**
         * List a project's channels
         * @description The channels that sockets of the server that answers are subscribed to, right now.
         */
        get: operations["adminListChannels"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/admin/v1/projects/{project}/channels/{channel}": {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
                /** @description The channel, URL-encoded. */
                channel: components["schemas"]["ChannelName"];
            };
            cookie?: never;
        };
        /**
         * Read a project's channel
         * @description How many sockets of the server that answers are subscribed to the channel right now. A channel nobody is subscribed to is not occupied.
         */
        get: operations["adminGetChannel"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** @description A project's id, also its namespace: `/projects/{project}`. */
        ProjectId: string;
        /** @description A project's public key. Clients send it when they connect, and applications with every API request. */
        PublicKey: string;
        /** @description A channel. `private-…` and `presence-…` channels need a signature from the application; any other channel is public. */
        ChannelName: string;
        /** @description The name of an event: printable ASCII, without spaces. Laravel's default event names (`App\\Events\\CommentCreated`) fit. */
        EventName: string;
        /** @description The id of a Socket.IO socket, as the client reads it (`socket.id`). It stays the same when the socket is recovered. */
        SocketId: string;
        /** @description An origin clients may connect from: a scheme, a host and an optional port, without a path. `*.` before the host allows its subdomains, one level or more, but not the host itself. */
        Origin: string;
        PublishRequest: {
            /** @description The channels to send the message to. A socket subscribed to several of them receives it once per channel. */
            channels: components["schemas"]["ChannelName"][];
            event: components["schemas"]["EventName"];
            /** @description Any JSON value. The serialized message must fit in the project's limit (10 KB by default). */
            data?: unknown;
            /** @description A socket that must not receive the message: the one whose action caused it (Laravel's `toOthers()`). */
            exceptSocketId?: components["schemas"]["SocketId"];
        };
        PublishBatchRequest: {
            messages: components["schemas"]["PublishRequest"][];
        };
        Channel: {
            channel: components["schemas"]["ChannelName"];
            /** @description Whether at least one socket is subscribed. */
            occupied: boolean;
            /** @description The number of sockets subscribed right now. */
            subscriptionCount: number;
        };
        Origins: {
            /** @description Clients that send an `Origin` header must send one of these. A client without one (a native app, a server) is accepted on the key alone. */
            origins: components["schemas"]["Origin"][];
        };
        Health: {
            /** @constant */
            status: "ok";
        };
        /** @description The `Pingpong-Signature` header of an API request: `t=<unix time>,v1=<hex HMAC-SHA256>`. The HMAC is of `{t}.{method}.{path}.{sha256}` with the project's secret, where `method` is upper case, `path` is the request target as sent (path and query string, without the host), and `sha256` is the hex SHA-256 of the body (of an empty body for a `GET`). Several `v1` values can follow: the request is valid if one of them matches the current secret or, during the grace period after a rotation, the previous one. */
        RequestSignature: string;
        /** @description What the application gives a client to join a private channel: the hex HMAC-SHA256 of `{socketId}:{channel}` with the project's secret. In PHP: `hash_hmac('sha256', "$socketId:$channel", $secret)`. */
        ChannelSignature: string;
        /** @description The `auth` of the Socket.IO handshake, on the namespace `/projects/{project}`. */
        SocketAuth: {
            key: components["schemas"]["PublicKey"];
        };
        /**
         * @description The `message` of the `connect_error` a client receives when Pingpong refuses its connection. `unknown_project`, `invalid_key`, `origin_not_allowed` and `project_disabled` are final: the client stops reconnecting. `too_many_connections` is not: it retries.
         * @enum {string}
         */
        SocketConnectError: "unknown_project" | "invalid_key" | "origin_not_allowed" | "project_disabled" | "too_many_connections";
        /** @description The `pingpong:connected` event, the first one a socket receives after each connection, recovered or not. */
        SocketConnected: {
            socketId: components["schemas"]["SocketId"];
            /** @description Whether the socket was recovered with its channels and what it missed. When it wasn't, the client subscribes again and reloads what it shows from the application. */
            recovered: boolean;
        };
        /** @description The `subscribe` event, sent by the client with an acknowledgement. */
        SocketSubscribeRequest: {
            channel: components["schemas"]["ChannelName"];
            signature?: components["schemas"]["ChannelSignature"];
        };
        /**
         * @description `unsupported_channel`: presence channels are not supported yet. `too_many_channels`: the socket reached its limit of channels.
         * @enum {string}
         */
        SocketSubscribeError: "invalid_request" | "invalid_signature" | "unsupported_channel" | "too_many_channels";
        /** @description The acknowledgement of `subscribe`. */
        SocketSubscribeResult: {
            /** @constant */
            ok: true;
            subscriptionCount: number;
        } | {
            /** @constant */
            ok: false;
            error: components["schemas"]["SocketSubscribeError"];
        };
        /** @description The `unsubscribe` event, sent by the client with an acknowledgement (`{ "ok": true }`). */
        SocketUnsubscribeRequest: {
            channel: components["schemas"]["ChannelName"];
        };
        /** @description The `message` event: a message published to a channel the socket is subscribed to. */
        SocketMessage: {
            channel: components["schemas"]["ChannelName"];
            event: components["schemas"]["EventName"];
            /** @description The JSON value that was published, if any. */
            data?: unknown;
        };
        /** @description The `pingpong:subscription_count` event: how many sockets are subscribed to a channel. Sent to its subscribers when the count changes, at most once every few seconds per channel. */
        SocketSubscriptionCount: {
            channel: components["schemas"]["ChannelName"];
            subscriptionCount: number;
        };
        /** @description A project's name, for people. */
        ProjectName: string;
        /** @description A project's secret. It signs API requests and private channels, and is never sent to clients. */
        ProjectSecret: string;
        /** @description A project's limits. */
        Limits: {
            /** @description Sockets connected to the project at once, on one server. */
            maxConnections: number;
            /** @description Messages the project may publish per second, one per channel. */
            maxMessagesPerSecond: number;
            /** @description Bytes of a message, serialized. */
            maxMessageSize: number;
            /** @description Channels one socket may subscribe to. */
            maxChannelsPerSocket: number;
        };
        /** @description The limits a project sets itself. The others are the server's defaults. */
        OwnLimits: {
            /** @description Sockets connected to the project at once, on one server. */
            maxConnections?: number;
            /** @description Messages the project may publish per second, one per channel. */
            maxMessagesPerSecond?: number;
            /** @description Bytes of a message, serialized. */
            maxMessageSize?: number;
            /** @description Channels one socket may subscribe to. */
            maxChannelsPerSocket?: number;
        };
        /** @description Limits to set. `null` goes back to the server's default. */
        LimitsPatch: {
            /** @description Sockets connected to the project at once, on one server. */
            maxConnections?: number | null;
            /** @description Messages the project may publish per second, one per channel. */
            maxMessagesPerSecond?: number | null;
            /** @description Bytes of a message, serialized. */
            maxMessageSize?: number | null;
            /** @description Channels one socket may subscribe to. */
            maxChannelsPerSocket?: number | null;
        };
        /** @description What the server that answers counted for the project since it started (`since`). Kept in memory: a restart starts them again. */
        ProjectStats: {
            /**
             * Format: date-time
             * @description When the server started counting.
             */
            since: string;
            /** @description Sockets connected right now. */
            connections: number;
            /** @description The most sockets connected at once. */
            peakConnections: number;
            /** @description Connections refused, by reason (`SocketConnectError`). A reason that never happened is left out. */
            connectionsRefused: {
                [key: string]: number;
            };
            /** @description Channels with at least one subscriber right now. */
            channels: number;
            /** @description Messages published: one per channel of each publish request. */
            messages: number;
            /** @description Bytes of the messages published, serialized. */
            bytes: number;
            /** @description Publish requests refused because the project reached its limit of messages per second. */
            rateLimited: number;
        };
        /** @description A project, as its operators see it. Never with its secret. */
        AdminProject: {
            id: components["schemas"]["ProjectId"];
            name: components["schemas"]["ProjectName"];
            key: components["schemas"]["PublicKey"];
            /** @description A disabled project refuses connections and API requests. */
            disabled: boolean;
            /** @description The origins clients may connect from. Empty: any client that has the key. */
            origins: components["schemas"]["Origin"][];
            /** @description The limits that apply: the project's own, or the server's defaults. */
            limits: components["schemas"]["Limits"];
            ownLimits: components["schemas"]["OwnLimits"];
            /**
             * Format: date-time
             * @description Until when the previous secret still works after a rotation. `null`: only the current one works.
             */
            previousSecretExpiresAt: string | null;
            /** Format: date-time */
            createdAt: string;
            /** Format: date-time */
            updatedAt: string;
            stats: components["schemas"]["ProjectStats"];
        };
        AdminProjectList: {
            projects: components["schemas"]["AdminProject"][];
        };
        AdminProjectCreate: {
            id: components["schemas"]["ProjectId"];
            /** @description The id when left out. */
            name?: components["schemas"]["ProjectName"];
            /** @description The origins clients may connect from. None: any client that has the key. */
            origins?: components["schemas"]["Origin"][];
            limits?: components["schemas"]["LimitsPatch"];
            /** @default false */
            disabled?: boolean;
        };
        AdminProjectCreated: {
            project: components["schemas"]["AdminProject"];
            /** @description Shown this once. */
            secret: components["schemas"]["ProjectSecret"];
        };
        AdminProjectPatch: {
            name?: components["schemas"]["ProjectName"];
            /** @description Replaces the origins. Empty: any client that has the key. */
            origins?: components["schemas"]["Origin"][];
            limits?: components["schemas"]["LimitsPatch"];
            /** @description `true` disconnects the project's sockets and refuses new ones. */
            disabled?: boolean;
        };
        AdminSecretRotation: {
            /** @description Seconds the previous secret stays valid. The server's `PINGPONG_SECRET_GRACE_PERIOD` when left out; `0` drops it now. */
            gracePeriod?: number;
        };
        AdminProjectSecret: {
            /** @description Shown this once. */
            secret: components["schemas"]["ProjectSecret"];
            /**
             * Format: date-time
             * @description Until when the previous secret still works. `null`: it no longer works.
             */
            previousSecretExpiresAt: string | null;
        };
        AdminChannelList: {
            channels: components["schemas"]["Channel"][];
            /** @description How many channels match, before `limit`. */
            total: number;
        };
        /** @description A check of `pingpong doctor`. */
        ServerCheck: {
            /** @description `database`, `migrations`, `secretKey` or `redis`. More can come. */
            name: string;
            /**
             * @description `skipped`: not configured, such as Redis on one server.
             * @enum {string}
             */
            status: "ok" | "failed" | "skipped";
            detail?: string;
        };
        /** @description The state of the server that answers, for its operators. */
        ServerStatus: {
            /** @description The server's version. */
            version: string;
            /** Format: date-time */
            startedAt: string;
            /** @description Whether every check passes. */
            healthy: boolean;
            checks: components["schemas"]["ServerCheck"][];
            /** @description Projects in the database. */
            projects: number;
            /** @description Sockets connected right now, every project. */
            connections: number;
            /** @description Channels with at least one subscriber right now, every project. */
            channels: number;
        };
        /** @description Problem details (RFC 9457). */
        Problem: {
            /**
             * Format: uri-reference
             * @description URI of the problem type. `about:blank` when the status says it all.
             * @default about:blank
             */
            type?: string;
            title: string;
            status: number;
            detail?: string;
            /** Format: uri-reference */
            instance?: string;
            /** @description Validation errors: messages by JSON pointer to the invalid value in the request body (`/messages/3/channels/0`). The empty pointer is the body itself. */
            errors?: {
                [key: string]: string[];
            };
        };
    };
    responses: {
        /** @description No key, an unknown key, or a missing, expired or wrong signature. */
        Unauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The request is invalid. `errors` lists the messages by JSON pointer. */
        Invalid: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description A message is larger than the project's limit, once serialized. */
        MessageTooLarge: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description The project reached its limit of messages per second. */
        TooManyRequests: {
            headers: {
                /** @description Seconds to wait before trying again. */
                "Retry-After"?: number;
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description No admin token, or a wrong one. */
        AdminUnauthorized: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description No such project. */
        NotFound: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
        /** @description A project with this id already exists. */
        Conflict: {
            headers: {
                [name: string]: unknown;
            };
            content: {
                "application/problem+json": components["schemas"]["Problem"];
            };
        };
    };
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    publishMessage: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublishRequest"];
            };
        };
        responses: {
            /** @description Accepted: the message is on its way to the channels' subscribers. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            413: components["responses"]["MessageTooLarge"];
            422: components["responses"]["Invalid"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    publishMessages: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["PublishBatchRequest"];
            };
        };
        responses: {
            /** @description Accepted: the messages are on their way, in order. */
            202: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["Unauthorized"];
            413: components["responses"]["MessageTooLarge"];
            422: components["responses"]["Invalid"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getChannel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The channel, URL-encoded. */
                channel: components["schemas"]["ChannelName"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The channel. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Channel"];
                };
            };
            401: components["responses"]["Unauthorized"];
            422: components["responses"]["Invalid"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getOrigins: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The origins clients may connect from. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Origins"];
                };
            };
            401: components["responses"]["Unauthorized"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    replaceOrigins: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["Origins"];
            };
        };
        responses: {
            /** @description The new origins. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Origins"];
                };
            };
            401: components["responses"]["Unauthorized"];
            422: components["responses"]["Invalid"];
            429: components["responses"]["TooManyRequests"];
        };
    };
    getHealth: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The server is up. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Health"];
                };
            };
            /** @description The database or Redis doesn't answer. */
            503: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/problem+json": components["schemas"]["Problem"];
                };
            };
        };
    };
    adminGetStatus: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The server's status. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ServerStatus"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
        };
    };
    adminListProjects: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The projects, by id. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProjectList"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
        };
    };
    adminCreateProject: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminProjectCreate"];
            };
        };
        responses: {
            /** @description The project, and its secret. The secret is only in this response. */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProjectCreated"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            409: components["responses"]["Conflict"];
            422: components["responses"]["Invalid"];
        };
    };
    adminGetProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The project, without its secret. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProject"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminDeleteProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Deleted. Its sockets are disconnected. */
            204: {
                headers: {
                    [name: string]: unknown;
                };
                content?: never;
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
        };
    };
    adminUpdateProject: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["AdminProjectPatch"];
            };
        };
        responses: {
            /** @description The project. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProject"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Invalid"];
        };
    };
    adminRotateProjectSecret: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: {
            content: {
                "application/json": components["schemas"]["AdminSecretRotation"];
            };
        };
        responses: {
            /** @description The new secret. It is only in this response. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminProjectSecret"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Invalid"];
        };
    };
    adminListChannels: {
        parameters: {
            query?: {
                /** @description Only the channels whose name starts with it. */
                prefix?: string;
                /** @description How many channels to return. */
                limit?: number;
            };
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The channels with at least one subscriber, most subscribed first. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["AdminChannelList"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Invalid"];
        };
    };
    adminGetChannel: {
        parameters: {
            query?: never;
            header?: never;
            path: {
                /** @description The project's id. */
                project: components["schemas"]["ProjectId"];
                /** @description The channel, URL-encoded. */
                channel: components["schemas"]["ChannelName"];
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description The channel. */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["Channel"];
                };
            };
            401: components["responses"]["AdminUnauthorized"];
            404: components["responses"]["NotFound"];
            422: components["responses"]["Invalid"];
        };
    };
}
