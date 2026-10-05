// Staff-only panels behind one grouped command. The gate travels on the
// flows and controls as inert data; the facts below bind the privilege
// names to the role IDs the pickers collect. The engine never sees
// session data: requests carry identity and the nearest declared gate.
// The picks live in the module-level store, which stands in for the
// database a real bot would query. They die with the process, on
// purpose: this is a demo of the seam, not of persistence.
import { action, command, ErrorSource, flow, mounts, policy, screen } from 'fluxcord';
import type { PrivilegeFacts } from 'fluxcord';

// --- The badge store: the engine's own truth --------------------------------------

const roleConfig = {
	// The bootstrap admin: the picker sits behind the admin door, so the
	// first admin role comes from .env (STAFF_ADMIN_ROLE_ID). Everything
	// after that is picked live.
	admin: process.env.STAFF_ADMIN_ROLE_ID !== undefined ? [process.env.STAFF_ADMIN_ROLE_ID] : ([] as readonly string[]),
	staff: [] as readonly string[],
};

// Names only: the gate rides the flows and controls, the facts at the
// bottom bind the names to role IDs.
const staffGate = policy.any(policy.owner(), policy.privilege('mod'), policy.privilege('admin'));

// The picker keeps no bag: the store above is the one source, and the
// screen reads it back through defaultIds on the next draw.
const pickStaff = action()(e => {
	roleConfig.staff = [...(e.values ?? [])];
});

const pickAdmin = action()(e => {
	roleConfig.admin = [...(e.values ?? [])];
});

const rolesScreen = screen()((_data, { Select }) => (
	<view>
		<text>
			Who counts as staff, and who can resolve tickets? New picks apply on the very next click, even
			panel that is already open.
		</text>
		<Select roles placeholder="Staff roles" onSelect={pickStaff} defaultIds={[...roleConfig.staff]} />
		<Select roles placeholder="Admin roles (may resolve tickets)" onSelect={pickAdmin} defaultIds={[...roleConfig.admin]} />
	</view>
));

const rolesFlow = flow('roles', {
	screens: { picker: rolesScreen },
	first: 'picker',
}, { policy: staffGate });

// --- The ticket desk ---------------------------------------------------------------

interface TicketData {
	open: number;
	pinged: boolean;
}

// Resolving is the gated control: the admin gate rides the button (the
// policy prop), gets stamped into the frame at draw time, and is
// checked at dispatch. Even the session owner needs an admin badge for
// this one.
const resolveNext = action<TicketData>()(e => {
	e.mutate(d => {
		d.open = Math.max(0, d.open - 1);
	});
});

// A real bot would call the assignee through Discord here; the stub
// flips a coin so the failure path actually fires during a demo.
const pingAssignee = action<TicketData>()(async e => {
	if (Math.random() < 0.5) throw new Error('the notification stack refused the ping');
	e.mutate(d => {
		d.pinged = true;
	});
});

const deskScreen = screen<TicketData>()((data, { Button }) => (
	<view>
		<text>The ticket desk: resolve what is handled, ping the assignee when a ticket sits. Wire the real queue to your own tracker.</text>
		<text>{data.open === 0 ? 'The queue is clear.' : `${data.open} ticket${data.open === 1 ? '' : 's'} in the queue.`}</text>
		<row>
			<Button
				onClick={resolveNext}
				label="Resolve the next"
				success
				disabled={data.open === 0}
				policy={policy.privilege('admin', { deny: 'Admins only.' })}
			/>
			<Button onClick={pingAssignee} label="Ping the assignee" secondary disabled={data.open === 0 || data.pinged} />
		</row>
		{data.pinged && <text>The assignee was pinged.</text>}
	</view>
));

export const ticketsFlow = flow<TicketData>('tickets', {
	screens: { desk: deskScreen },
	first: 'desk',
	initialData: { open: 3, pinged: false },
	onError: report => {
		if (report.source === ErrorSource.Handler) {
			return 'The notification stack refused the ping. Give it a moment, then try again.';
		}
		return undefined;
	},
}, { policy: staffGate });

// --- The facts: where the names meet the role IDs ---------------------------------

// The shipped engine asks per click and never caches, so a picker
// change applies to the next click on any open panel.
export const staffFacts: PrivilegeFacts = {
	async privileges(_actorId, _guildId, roleIds) {
		const ids = roleIds ?? [];
		const names = new Set<string>();
		if (ids.some(id => roleConfig.admin.includes(id))) names.add('admin');
		if (ids.some(id => roleConfig.staff.includes(id))) names.add('mod');
		return [...names];
	},
};

export const staffCommand = command('staff', 'Moderation panels for server staff', {
	subcommands: {
		roles: mounts(rolesFlow, { description: 'Pick the staff and admin roles', policy: policy.privilege('admin', { deny: 'Admins only.' }) }),
		tickets: mounts(ticketsFlow, { description: 'Open the ticket desk', ephemeral: true, policy: staffGate }),
	},
});
