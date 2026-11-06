import type { ColumnType } from 'kysely';

/** A `Date` from PostgreSQL, ISO 8601 text from SQLite. Written as a `Date`. */
type Timestamp = ColumnType<Date | string, Date, Date>;
type NullableTimestamp = ColumnType<Date | string | null, Date | null | undefined, Date | null>;
type Nullable<T> = ColumnType<T | null, T | null | undefined, T | null>;

export interface ProjectsTable {
    /** The project's id, also its namespace: `/projects/{id}`. */
    id: string;
    name: string;
    /** The public key (`pk_…`). */
    key: string;
    /** The secret, encrypted with `PINGPONG_SECRET_KEY`. */
    secret: string;
    /** After a rotation, the previous secret, encrypted, until it expires. */
    previous_secret: Nullable<string>;
    previous_secret_expires_at: NullableTimestamp;
    /** The allowed origins, as a JSON array of strings. */
    origins: string;
    /** Limits; null when the project uses the server's default. */
    max_connections: Nullable<number>;
    max_messages_per_second: Nullable<number>;
    max_message_size: Nullable<number>;
    max_channels_per_socket: Nullable<number>;
    created_at: Timestamp;
    updated_at: Timestamp;
    disabled_at: NullableTimestamp;
}

export interface Tables {
    projects: ProjectsTable;
}
