/**
 * Flow types: the shapes authors use to declare a flow.
 *
 * A flow wraps a group of screens and owns the shared rules of one
 * guided experience: entry point, TTL, death copy, and the components
 * drawn around every screen. `defineFlow` builds the runtime artifact;
 * this module only names the pieces authors touch.
 *
 * @module flow/types
 */

import type { ActionHandler, ErrorReport, PartingOptions } from '../pipeline/types.js';
import type { Session } from '../state/types.js';
import type { RemountPolicy } from '../state/types.js';
import type { ScreenKit } from '../tree/kit.js';
import type { ComponentResult, ViewNode } from '../tree/types.js';

// used in docs
/* eslint-disable @typescript-eslint/no-unused-vars */
import { screen } from './screen.js';
import { defineFlow, subflow } from './define.js';
/* eslint-enable */

/**
 * Recursively readonly view of a data bag: what a screen's view receives.
 * Field writes and array pushes inside a view fail to compile, so a view
 * can render but never mutate flow data. Handlers mutate through the
 * plain bag on `event.mutate` instead. The readonly view is the same
 * object at runtime; only the type is readonly.
 */
export type DeepReadonly<T> =
	T extends (...args: never[]) => unknown ?
		T : T extends object ?
			{ readonly [K in keyof T]: DeepReadonly<T[K]> } : T;

/**
 * One screen as authored. The view is the whole screen: its controls bind
 * their handlers directly, and drawing the view registers those handlers.
 * There is no separate action declaration to keep in sync.
 */
export interface AuthorScreen<TData = unknown, TKeys extends string = string> {
	/**
	 * The screen's template: flow data in, view tree out. It receives a
	 * readonly view of the bag (see {@link DeepReadonly}) and the typed
	 * control builders (see {@link ScreenKit}); a view may ignore the kit
	 * and build raw nodes instead.
	 *
	 * The return is the element union: builder views hand back a view node,
	 * TSX views return a component, and the commit phase folds the root to
	 * a view node before rendering. Do not mutate `data`; handlers change
	 * it through `event.mutate` and the flow redraws.
	 *
	 * Build screens with {@link screen}: it types the kit's keys from the
	 * flow's screens map, so inline handlers need no annotations.
	 */
	readonly view: (data: DeepReadonly<TData>, controls: ScreenKit<TData, TKeys>) => ComponentResult;
}

/**
 * A plug-and-play flow component: a bare function that draws around every
 * screen. It receives the normalized view tree and returns the element
 * union (folded back to a view node between links). Components are
 * library material, never machinery.
 */
export type FlowComponent<TData = unknown> = (
	tree: ViewNode,
	session: Session<TData>,
) => ComponentResult;

/** What defineFlow accepts; TData is the flow's one shared bag type. */
export interface FlowOptions<TData, TScreens extends string = string> {
	readonly screens: Readonly<Record<TScreens, AuthorScreen<TData, TScreens>>>;
	/** Where the journey starts. */
	readonly first: TScreens;
	/**
	 * The flow's fresh data bag: declare its shape here, next to the
	 * screens that use it. Every session gets its own clone, so two panels
	 * never share state. Values that depend on the invocation (who ran the
	 * command, which lotto) arrive via the `onSessionStart` hook plus
	 * `handle.redraw`, not by widening this bag.
	 *
	 * Keep the bag plain JSON data: functions or class instances throw at
	 * mount.
	 */
	readonly initialData: TData;
	/**
	 * Components drawn around every screen, as an onion: the first entry
	 * sits closest to the screen, later entries wrap around it, and each
	 * receives the tree the entries before it produced. Omit for a flow
	 * with no chrome.
	 */
	readonly components?: readonly FlowComponent<TData>[];
	/** Subflows plugged into this flow; build each with {@link subflow}. Omit for none. */
	readonly subflows?: readonly SubflowPlug[];
	/** The session's sliding TTL in milliseconds. Default: 30 minutes. Must be finite and positive; `Infinity` throws. */
	readonly ttlMs?: number;
	/** What a mount does when the owner already holds a live panel of this flow. Default: `'replace'` closes the old panel. */
	readonly remount?: RemountPolicy;
	/**
	 * Death copy: a restart command, an extra note, or a whole custom
	 * parting screen. Omit for the default: the mounting command becomes
	 * the restart hint.
	 */
	readonly parting?: PartingOptions;
	/**
	 * Decides user-facing reply text per failure from this flow's screens;
	 * return `undefined` to fall through to the default. Delivery and logging
	 * stay with the error socket.
	 */
	readonly onError?: (report: ErrorReport) => string | undefined;
	/**
	 * Opts the flow into rehydration: when a click lands on a dead
	 * session, this rebuilds the bag from the database and the session is
	 * revived. Omit for no revive. Returning `undefined` means the
	 * underlying object is gone: the click gets the parting screen instead.
	 */
	readonly rehydrate?: (ref: string) => TData | undefined | Promise<TData | undefined>;
}

/** A plugged subflow (built via the {@link subflow} helper, which infers types). */
export interface SubflowPlug {
	/** Internal erased form; use {@link subflow} to build one. */
	readonly use: FlowDefinition;
	/**
	 * The parent-bag key this subflow works in (its data slot) and its
	 * namespace: subflow screens register as `'<at>.<screen>'` and
	 * `ui.go('<at>')` opens the subflow at its first screen. One plug
	 * per key.
	 */
	readonly at: string;
	/**
	 * The subflow finisher. ONE function object: the parent's views bind it
	 * `(button({ onClick: plug.done }))` and the frame harvest at draw time
	 * registers it. It pops history, then hands the slot state to the
	 * `onDone` callback given to {@link subflow}.
	 */
	readonly done: ActionHandler;
}

/**
 * The runtime flow definition: built by {@link defineFlow}, then either
 * mounted by the boot layer or plugged as a subflow. `TData` survives only
 * as the type-level channel for {@link subflow} inference (see {@link __data});
 * every other field is erased so downstream machinery never fights type
 * variance. `FlowDefinition` with no type argument is the fully erased
 * form.
 */
export interface FlowDefinition<TData = never> {
	/** Type-only; never present at runtime. Carries `TData` from `defineFlow` to `subflow()`'s inference. */
	readonly __data?: (data: TData) => void;
	/** Merged screen map: own screens plus namespaced subflow screens (`<at>.<screen>`). */
	readonly screens: Readonly<Record<string, AuthorScreen<TData>>>;
	/** All screen keys, namespaced where a subflow supplied them. */
	readonly screenIds: readonly string[];
	/** The screen the flow opens at. */
	readonly first: string;
	/**
	 * The flow's fresh bag, from `FlowOptions.initialData`. Erased to
	 * `unknown` here. Carried as-is: freezing the definition never freezes
	 * the bag itself, and mount clones it into each new session.
	 */
	readonly initialData: unknown;
	/** The composed component chain; absent when the flow declares no components. */
	readonly wrap?: (tree: ViewNode, session: Session<TData>) => ComponentResult;
	/** Full screen key to bag path: the slice of the bag each screen works in. Own screens map to `[]`. */
	readonly slots: Readonly<Record<string, readonly string[]>>;
	/** Namespace root to the screen id `ui.go(root)` opens. */
	readonly roots: Readonly<Record<string, string>>;
	/** The flow's sliding TTL in milliseconds. */
	readonly ttlMs: number;
	/** The resolved remount policy (`'replace'` when undeclared). */
	readonly remount: RemountPolicy;
	/** Death copy, carried from `FlowOptions`; absent when undeclared. */
	readonly parting?: PartingOptions;
	/** Per-failure reply text decider, carried from `FlowOptions`; absent when undeclared. */
	readonly onError?: (report: ErrorReport) => string | undefined;
	/** Rehydration hook, carried from `FlowOptions`; absent means no revive. */
	readonly rehydrate?: (ref: string) => unknown | Promise<unknown>;
}
