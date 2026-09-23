// Shared vocabulary for the taco stand: the order bag and the menu lists.
export interface OrderData {
	size?: string;
	toppings: readonly string[];
	name?: string;
	napkins?: boolean;
}

export const SIZES = [
	{ label: 'Regular', value: 'regular' },
	{ label: 'Large', value: 'large' },
	{ label: 'Monster', value: 'monster' },
];

export const TOPPINGS = [
	{ label: 'Extra cheese', value: 'cheese' },
	{ label: 'Grilled onions', value: 'onions' },
	{ label: 'Hot sauce', value: 'hot' },
	{ label: 'Guacamole', value: 'guac' },
];
