/** Something that doesn't exist. */
export class NotFoundError extends Error {}

/** Something that conflicts with what exists, such as a project id that is taken. */
export class ConflictError extends Error {}

/** A value that is invalid, with what is wrong with it. */
export class InvalidValueError extends Error {}
