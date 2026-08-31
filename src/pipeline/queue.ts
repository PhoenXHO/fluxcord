/**
 * Per-session FIFO queue: one checkout line per live message.
 *
 * Everything dispatched to one session id lines up behind whatever came
 * before it: handlers, revive attempts, parting commits. Work on the same
 * session's single data object never interleaves; different session ids
 * never block each other. A failed entry does not jam the line, and a
 * drained line leaves no entry behind.
 *
 * @module pipeline/queue
 */

export interface SessionQueue {
	/**
	 * Runs the job once every earlier job under the same key has settled.
	 * Resolves (or rejects) with the job's own outcome; that outcome never
	 * affects the next entry.
	 */
	enqueue<T>(key: string, job: () => Promise<T>): Promise<T>;
}

export function createSessionQueue(): SessionQueue {
	const tails = new Map<string, Promise<unknown>>();

	return {
		enqueue<T>(key: string, job: () => Promise<T>): Promise<T> {
			// The stored tail is always a settled-shaped promise, so .then(job)
			// cannot skip the job and the chain cannot reject.
			const previous = tails.get(key) ?? Promise.resolve();
			const run = previous.then(job);
			const settled = run.then(
				() => undefined,
				() => undefined,
			);
			tails.set(key, settled);
			void settled.then(() => {
				// Drop the entry once drained, unless a newer entry already
				// replaced it.
				if (tails.get(key) === settled) {
					tails.delete(key);
				}
			});
			return run;
		},
	};
}
