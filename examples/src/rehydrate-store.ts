// The whole persistence contract is three methods, so the store fits on
// a napkin: rows live in one JSON file, keyed by message id. A real bot
// swaps this file for its database; fluxcord never knows the difference.
import { readFile, writeFile } from 'node:fs/promises';
import type { RehydrateRow, RehydrateStore } from 'fluxcord';

const ROWS_FILE = 'rehydrate-rows.json';

async function readRows(): Promise<Record<string, RehydrateRow>> {
	try {
		return JSON.parse(await readFile(ROWS_FILE, 'utf8')) as Record<string, RehydrateRow>;
	} catch {
		return {};
	}
}

async function writeRows(rows: Record<string, RehydrateRow>): Promise<void> {
	await writeFile(ROWS_FILE, JSON.stringify(rows, null, '\t'));
}

export const rehydrateStore: RehydrateStore = {
	async put(row) {
		const rows = await readRows();
		rows[row.messageId] = row;
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
};
