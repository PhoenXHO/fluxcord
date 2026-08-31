/**
 * The commit phase: trees become message edits.
 *
 * One draw pipeline: resolve the screen, call its view template on the
 * session's data, materialize the tree (stamps + frame), render the V2
 * payload, and hand the payload to the bridge's editMessage. Everything user-visible
 * the framework does on its own funnels through here: redraws, the
 * close-freeze, and the parting screen.
 *
 * Every draw records the session's frame: the map of every handler the
 * rendered tree placed on the message. Dispatch resolves clicks against
 * that map, so what was last drawn is exactly what can run.
 *
 * Final edits (freeze, parting) mark the message in a done-set: once the
 * framework has said goodbye to a message, no later path edits it again.
 * A laggy dead click cannot overwrite a frozen screen with generic parting
 * copy, and the sweeper cannot re-part an already-parted message.
 *
 * @module commit/commit
 */

import { renderV2Message } from '../render/v2.js';
import type { V2MessagePayload } from '../render/v2.js';
import type { MessageRef, Session } from '../state/types.js';
import type { PartingOptions, PlatformPort, ScreenRegistry } from '../pipeline/types.js';
import type { ViewNode } from '../tree/types.js';
import { runtimeKit } from '../tree/kit.js';
import { normalizeViewRoot } from '../tree/normalize.js';
import { getPath } from '../flow/lens.js';
import { materializeTree } from './frame.js';
import { freezeTree } from './freeze.js';
import { partingView } from './parting.js';

export interface CommitPhase {
	/** Re-render the session's current screen and edit the message in place. */
	redraw(session: Session<unknown>): Promise<void>;
	/** Render the session's final screen frozen (controls stripped) and edit the message in place. */
	commitFreeze(session: Session<unknown>): Promise<void>;
	/**
	 * Edit a dead message into the parting screen: the flow's bundle
	 * (custom view, or command hint + note) or the framework default. No-op
	 * when the message already received its final edit. The commandHint is
	 * the mounting command's invocation path: the fallback when the flow
	 * declares no parting.command of its own.
	 */
	commitParting(messageRef: MessageRef, parting?: PartingOptions, commandHint?: string): Promise<void>;
}

export interface CommitOptions {
	/** The bridge's message-edit seam. */
	readonly platform: Pick<PlatformPort, 'editMessage'>;
	/** Resolves screen keys to screens. */
	readonly screens: ScreenRegistry;
}

/**
 * Resolves the session's current screen and runs its view template:
 * subflow screens view their slot (lensed read), then the flow's wrap
 * draws around the result. Shared by the commit phase (redraw/freeze)
 * and mount's first render (which passes a draft session, same shape,
 * messageRef still pending until the send returns).
 */
export function viewOf(session: Session<unknown>, screens: ScreenRegistry): ViewNode {
	const key = `${session.moduleId}/${session.screen}`;
	const screen = screens.resolve(key);
	if (screen === undefined) {
		throw new Error(`no screen registered for '${key}'`);
	}
	const data = screen.slot === undefined ? session.data : getPath(session.data, screen.slot);
	// Views return the element union (TSX roots type flat), folded to a
	// view node here, one place; validateTree polices the walk next. Same
	// for the composed wrap's result.
	let tree = normalizeViewRoot(screen.view(data, runtimeKit));
	if (screen.flow?.wrap !== undefined) {
		tree = normalizeViewRoot(screen.flow.wrap(tree, session));
	}
	return tree;
}

export function createCommit(options: CommitOptions): CommitPhase {
	/** Message ids that received their final edit: freeze or parting. */
	const done = new Set<string>();

	/**
	 * One draw: materialize the tree (stamping controls, building the
	 * frame), then render the payload from the same stamps. The frame and
	 * the pixels can never disagree: they come from the same walk.
	 */
	function draw(session: Session<unknown>, tree: ViewNode): V2MessagePayload {
		const materialized = materializeTree(tree);
		session.frame = materialized.frame;
		return renderV2Message(tree, session.id, `${session.moduleId}/${session.screen}`, materialized.stampOf);
	}

	return {
		async redraw(session: Session<unknown>): Promise<void> {
			await options.platform.editMessage(session.messageRef, draw(session, viewOf(session, options.screens)));
		},

		async commitFreeze(session: Session<unknown>): Promise<void> {
			if (done.has(session.messageRef.messageId)) return;
			// The frozen tree carries no controls: harvesting it empties the
			// frame, closing the message for clicks.
			await options.platform.editMessage(session.messageRef, draw(session, freezeTree(viewOf(session, options.screens))));
			done.add(session.messageRef.messageId);
		},

		async commitParting(messageRef: MessageRef, parting?: PartingOptions, commandHint?: string): Promise<void> {
			if (done.has(messageRef.messageId)) return;
			const tree = parting?.view !== undefined
				? normalizeViewRoot(parting.view())
				: partingView(parting?.command ?? commandHint, parting?.note);
			// Parting screens are dead ends: no session, no screen to name.
			// 'parting' marks the namespace; a stray control click there finds
			// no session and no-ops back into the done-set. Parting views carry
			// no controls by design, so materializing is a no-op walk, but the
			// renderer's required stamp lookup keeps even this path honest.
			const materialized = materializeTree(tree);
			await options.platform.editMessage(messageRef, renderV2Message(tree, messageRef.messageId, 'parting', materialized.stampOf));
			done.add(messageRef.messageId);
		},
	};
}
