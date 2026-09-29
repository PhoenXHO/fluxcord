// Staff-only panels behind one grouped command. The permission knob from
// the command chapter guards the door; the engine below guards every
// click after it, and declared gates (the policy prop) ride to it as
// data on the request.
//
// The engine never sees session data: requests carry identity and the
// clicked control's declared gate, nothing else. So the role picks live
// in the module-level store below, which stands in for the database a
// real bot would query. They die with the process, on purpose: this is
// a demo of the seam, not of persistence.
import { PermissionFlagsBits } from 'discord.js';
import { action, command, ErrorSource, flow, hasAnyRole, isOwner, mounts, screen } from 'fluxcord';
import type { PolicyPort } from 'fluxcord';

// --- The badge store: the engine's own truth --------------------------------------

const roleConfig = {
	staff: [] as readonly string[],
	admin: [] as readonly string[],
};

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
			Who counts as staff, and who can resolve tickets? New picks apply to fresh panels right away; a
			panel that is already open adopts them on its next draw.
		</text>
		<Select roles placeholder="Staff roles" onSelect={pickStaff} defaultIds={[...roleConfig.staff]} />
		<Select roles placeholder="Admin roles (may resolve tickets)" onSelect={pickAdmin} defaultIds={[...roleConfig.admin]} />
	</view>
));

const rolesFlow = flow('roles', {
	screens: { picker: rolesScreen },
	first: 'picker',
});

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
				policy={{ roles: { mode: 'allow', roleIds: [...roleConfig.admin] } }}
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
});

// --- The engine --------------------------------------------------------------------

// Answers the one question per click: a control that declared its own
// gate answers to that gate alone; everything else opens to the panel's
// owner or the staff roles. The identity checks are fluxcord's exported
// request helpers; the engine only decides what they mean.
export const staffPolicy: PolicyPort = {
	authorize(request) {
		const gate = request.actionPolicy;
		if (gate?.roles?.roleIds !== undefined) {
			return hasAnyRole(request, gate.roles.roleIds)
				? Promise.resolve({ allowed: true })
				: Promise.resolve({ allowed: false, denyMessage: 'Admins only.' });
		}
		if (isOwner(request) || hasAnyRole(request, roleConfig.staff)) {
			return Promise.resolve({ allowed: true });
		}
		return Promise.resolve({ allowed: false, denyMessage: 'Staff only.' });
	},
};

export const staffCommand = command('staff', 'Moderation panels for server staff', {
	memberPermissions: PermissionFlagsBits.ManageMessages,
	subcommands: {
		roles: mounts(rolesFlow, { description: 'Pick the staff and admin roles' }),
		tickets: mounts(ticketsFlow, { description: 'Open the ticket desk', ephemeral: true }),
	},
});
