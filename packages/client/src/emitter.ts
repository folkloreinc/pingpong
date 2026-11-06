type Listener<T> = (payload: T) => void;

/** A small typed event emitter, without dependencies, for browsers and Node. */
export class Emitter<Events extends Record<string, unknown>> {
    readonly #listeners = new Map<keyof Events, Set<Listener<never>>>();

    on<E extends keyof Events>(event: E, listener: Listener<Events[E]>): () => void {
        let listeners = this.#listeners.get(event);
        if (listeners === undefined) {
            listeners = new Set();
            this.#listeners.set(event, listeners);
        }
        listeners.add(listener as Listener<never>);
        return () => this.off(event, listener);
    }

    off<E extends keyof Events>(event: E, listener: Listener<Events[E]>): void {
        this.#listeners.get(event)?.delete(listener as Listener<never>);
    }

    protected emit<E extends keyof Events>(event: E, payload: Events[E]): void {
        for (const listener of [...(this.#listeners.get(event) ?? [])]) {
            (listener as Listener<Events[E]>)(payload);
        }
    }

    protected removeAllListeners(): void {
        this.#listeners.clear();
    }
}
