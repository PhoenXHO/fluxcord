/**
 * Command arguments: the typed inputs a slash command takes.
 *
 * A leaf declares them with the `arg` helpers, in the order the command
 * line shows them, and the leaf's `data` resolver receives the values the
 * invoker typed, typed from the declaration. The helpers return plain
 * frozen data; the Discord binding reads it when it registers the command
 * and when it parses an invocation. Nothing here touches the platform.
 *
 * ```ts
 * mounts(whoisFlow, {
 *   args: [
 *     arg.user('member', 'Who to look up'),
 *     arg.integer('torn_id', 'Or a Torn id', { min: 1 }),
 *   ],
 *   data: (interaction, args) => seed(args.member, args.torn_id),
 * })
 * ```
 *
 * They are called args, not options, because `option` is already the select
 * menu's `<option>` tag.
 *
 * @module command/args
 */

/** The value kinds a slash command argument can have. */
export type ArgKind = 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'channel' | 'role';

/** One fixed choice: what the invoker sees, and the value the flow gets. */
export interface ArgChoice<V extends string | number = string | number> {
	readonly name: string;
	readonly value: V;
}

/**
 * A declared argument. The name is a literal type so the values object can
 * be keyed by it; `required` is a literal so required arguments lose their
 * `undefined`. `__value` exists only for the type system and is never set.
 */
export interface ArgDef<N extends string = string, V = unknown, R extends boolean = boolean> {
	readonly name: N;
	readonly kind: ArgKind;
	readonly description: string;
	readonly required: R;
	readonly choices?: readonly ArgChoice[];
	readonly min?: number;
	readonly max?: number;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly __value?: V;
}

/** Any argument, for the erased places that treat them generically. */
export type AnyArg = ArgDef<string, unknown, boolean>;

type ValueOf<D> = D extends { readonly __value?: infer V } ? Exclude<V, undefined> : never;

/**
 * What a leaf's `data` resolver receives: one property per declared
 * argument, optional unless declared `required: true`. User, channel and
 * role arguments arrive as ids.
 */
export type ArgValues<A extends readonly AnyArg[]> =
	{ [D in Extract<A[number], { readonly required: true }> as D['name']]: ValueOf<D> } &
	{ [D in Exclude<A[number], { readonly required: true }> as D['name']]?: ValueOf<D> };

interface CommonExtras<R extends boolean> {
	/** Required arguments must come first; the default is optional. */
	readonly required?: R;
}

export interface StringArgExtras<R extends boolean, C extends string> extends CommonExtras<R> {
	/** A fixed list the invoker picks from. A bare string is its own label. */
	readonly choices?: readonly (C | ArgChoice<C>)[];
	readonly minLength?: number;
	readonly maxLength?: number;
}

export interface NumberArgExtras<R extends boolean, C extends number> extends CommonExtras<R> {
	/** A fixed list the invoker picks from. A bare number is its own label. */
	readonly choices?: readonly (C | ArgChoice<C>)[];
	readonly min?: number;
	readonly max?: number;
}

function normalizeChoices(choices: readonly (string | number | ArgChoice)[] | undefined): readonly ArgChoice[] | undefined {
	if (choices === undefined) return undefined;
	return Object.freeze(choices.map((choice) =>
		typeof choice === 'object' ? Object.freeze({ ...choice }) : Object.freeze({ name: String(choice), value: choice })));
}

function make<N extends string, V, R extends boolean>(
	kind: ArgKind,
	name: N,
	description: string,
	extras: {
		required?: R;
		choices?: readonly (string | number | ArgChoice)[];
		min?: number;
		max?: number;
		minLength?: number;
		maxLength?: number;
	},
): ArgDef<N, V, R> {
	const choices = normalizeChoices(extras.choices);
	return Object.freeze({
		name,
		kind,
		description,
		required: (extras.required ?? false) as R,
		...(choices !== undefined ? { choices } : {}),
		...(extras.min !== undefined ? { min: extras.min } : {}),
		...(extras.max !== undefined ? { max: extras.max } : {}),
		...(extras.minLength !== undefined ? { minLength: extras.minLength } : {}),
		...(extras.maxLength !== undefined ? { maxLength: extras.maxLength } : {}),
	});
}

/**
 * The argument helpers. Each takes the name the command line shows, a
 * description, and the extras that apply to that kind. Optional unless
 * `{ required: true }`.
 */
export const arg = {
	/** Free text, or one of fixed `choices`. */
	string<const N extends string, const R extends boolean = false, const C extends string = string>(
		name: N, description: string, extras: StringArgExtras<R, C> = {},
	): ArgDef<N, C, R> {
		return make<N, C, R>('string', name, description, extras);
	},
	/** A whole number, or one of fixed `choices`. */
	integer<const N extends string, const R extends boolean = false, const C extends number = number>(
		name: N, description: string, extras: NumberArgExtras<R, C> = {},
	): ArgDef<N, C, R> {
		return make<N, C, R>('integer', name, description, extras);
	},
	/** Any number, or one of fixed `choices`. */
	number<const N extends string, const R extends boolean = false, const C extends number = number>(
		name: N, description: string, extras: NumberArgExtras<R, C> = {},
	): ArgDef<N, C, R> {
		return make<N, C, R>('number', name, description, extras);
	},
	/** True or false. */
	boolean<const N extends string, const R extends boolean = false>(
		name: N, description: string, extras: CommonExtras<R> = {},
	): ArgDef<N, boolean, R> {
		return make<N, boolean, R>('boolean', name, description, extras);
	},
	/** A server member, delivered as their id. */
	user<const N extends string, const R extends boolean = false>(
		name: N, description: string, extras: CommonExtras<R> = {},
	): ArgDef<N, string, R> {
		return make<N, string, R>('user', name, description, extras);
	},
	/** A channel, delivered as its id. */
	channel<const N extends string, const R extends boolean = false>(
		name: N, description: string, extras: CommonExtras<R> = {},
	): ArgDef<N, string, R> {
		return make<N, string, R>('channel', name, description, extras);
	},
	/** A role, delivered as its id. */
	role<const N extends string, const R extends boolean = false>(
		name: N, description: string, extras: CommonExtras<R> = {},
	): ArgDef<N, string, R> {
		return make<N, string, R>('role', name, description, extras);
	},
} as const;

// Discord's limits, checked when the command is declared so a bad
// declaration fails at module load instead of at registration.
const MAX_ARGS = 25;
const MAX_CHOICES = 25;
const MAX_DESCRIPTION = 100;
const ARG_NAME = /^[-_\p{L}\p{N}]{1,32}$/u;

/**
 * Checks a leaf's arguments against Discord's rules. Throws with the
 * command path in the message.
 *
 * @param owner The leaf's invocation path ('whois', 'tool run'), for messages.
 */
export function validateArgs(owner: string, args: readonly AnyArg[]): void {
	const fail = (message: string): never => {
		throw new Error(`command '${owner}': ${message}`);
	};
	if (args.length > MAX_ARGS) fail(`takes ${args.length} arguments, Discord allows ${MAX_ARGS}`);
	const seen = new Set<string>();
	let sawOptional = false;
	for (const def of args) {
		const label = `argument '${def.name}'`;
		if (!ARG_NAME.test(def.name) || def.name !== def.name.toLowerCase()) {
			fail(`${label} must be 1 to 32 lowercase letters, numbers, '-' or '_'`);
		}
		if (seen.has(def.name)) fail(`${label} is declared twice`);
		seen.add(def.name);
		if (def.description.length === 0 || def.description.length > MAX_DESCRIPTION) {
			fail(`${label} needs a description of 1 to ${MAX_DESCRIPTION} characters`);
		}
		if (def.required) {
			if (sawOptional) fail(`${label} is required but follows an optional argument; Discord needs required arguments first`);
		} else {
			sawOptional = true;
		}

		const numeric = def.kind === 'integer' || def.kind === 'number';
		if (def.choices !== undefined) {
			if (def.kind !== 'string' && !numeric) fail(`${label} is a ${def.kind}, which cannot have choices`);
			if (def.choices.length === 0 || def.choices.length > MAX_CHOICES) fail(`${label} needs 1 to ${MAX_CHOICES} choices`);
			if (def.min !== undefined || def.max !== undefined || def.minLength !== undefined || def.maxLength !== undefined) {
				fail(`${label} has choices, which cannot be combined with a min or max`);
			}
			for (const choice of def.choices) {
				if (choice.name.length === 0 || choice.name.length > 100) fail(`${label} has a choice whose label is not 1 to 100 characters`);
				if (def.kind === 'string' && typeof choice.value !== 'string') fail(`${label} has a non-text choice`);
				if (numeric && typeof choice.value !== 'number') fail(`${label} has a non-numeric choice`);
				if (def.kind === 'integer' && !Number.isInteger(choice.value)) fail(`${label} has a choice that is not a whole number`);
			}
		}
		if ((def.min !== undefined || def.max !== undefined) && !numeric) fail(`${label} is a ${def.kind}, which has no min or max`);
		if ((def.minLength !== undefined || def.maxLength !== undefined) && def.kind !== 'string') fail(`${label} is a ${def.kind}, which has no length limits`);
		if (def.min !== undefined && def.max !== undefined && def.min > def.max) fail(`${label} has a min above its max`);
		if (def.minLength !== undefined && def.maxLength !== undefined && def.minLength > def.maxLength) fail(`${label} has a minLength above its maxLength`);
		if (def.kind === 'integer') {
			for (const bound of [def.min, def.max]) {
				if (bound !== undefined && !Number.isInteger(bound)) fail(`${label} is an integer but has a bound that is not a whole number`);
			}
		}
	}
}
