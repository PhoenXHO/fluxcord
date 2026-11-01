// The persistence contract is three methods plus two for retention, so the
// store fits on a napkin: rows live in one JSON file, keyed by message id,
// each stamped with when it was last used. A real bot swaps this file for
// its database; fluxcord never knows the difference.
import { readFile, writeFile } from 'node:fs/promises';
import type { RehydrateRow, RehydrateStore } from 'fluxcord';

const ROWS_FILE = 'rehydrate-rows.json';

type StoredRow = RehydrateRow & { usedAt: number };

async function readRows(): Promise<Record<string, StoredRow>> {
	try {
		return JSON.parse(await readFile(ROWS_FILE, 'utf8')) as Record<string, StoredRow>;
	} catch {
		return {};
	}
}

async function writeRows(rows: Record<string, StoredRow>): Promise<void> {
	await writeFile(ROWS_FILE, JSON.stringify(rows, null, '\t'));
}

export const rehydrateStore: RehydrateStore = {
	async put(row) {
		const rows = await readRows();
		rows[row.messageId] = { ...row, usedAt: Date.now() };
		await writeRows(rows);
	},
	async get(messageId) {
		return (await readRows())[messageId];
	},
	async delete(messageId) {
		const rows = await readRows();
		delete rows[messageId];
		await writeRows(rows);
	},
	// The row's session just died or was revived: it counts as used now.
	async touch(messageId) {
		const rows = await readRows();
		if (rows[messageId] === undefined) return;
		rows[messageId].usedAt = Date.now();
		await writeRows(rows);
	},
	// Drops the flow's rows nobody has used since `olderThan`.
	async purge(flowId, olderThan) {
		const rows = await readRows();
		let purged = 0;
		for (const [messageId, row] of Object.entries(rows)) {
			if (row.flowId === flowId && row.usedAt < olderThan.getTime()) {
				delete rows[messageId];
				purged += 1;
			}
		}
		if (purged > 0) await writeRows(rows);
		return purged;
	},
};
