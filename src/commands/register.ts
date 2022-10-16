import {
	Argument,
	ArgumentType,
	Command,
	CommandOptions,
	CommandResponse,
	CommandSource,
} from '@matteopolak/framecord';
import {
	AuthCodeResponse,
	AuthResponseSuccess,
	getPlayerData,
} from '@providers/mcoauth';
import { prisma } from 'database';
import { escapeMarkdown } from 'discord.js';

export default class Register extends Command {
	constructor(options: CommandOptions) {
		super(options);

		this.arguments.push(
			new Argument({
				name: 'code',
				description: 'Your code from auth.mc-oauth.com',
				type: ArgumentType.Integer,
				minValue: 100000,
				maxValue: 999999,
				mapper: (_, code) => getPlayerData(code),
				filter: (_, response) => response.success,
				error: 'You did not provide a valid authentication code.',
			}),
		);
	}

	public async run(
		source: CommandSource,
		response: AuthResponseSuccess<AuthCodeResponse>,
	): CommandResponse {
		const createParty = prisma.party.create({
			data: {
				leaderId: source.user.id,
			},
		});

		const createUser = prisma.user.upsert({
			where: {
				id: source.user.id,
			},
			update: {
				username: response.ign,
				uuid: response.uuid,
			},
			create: {
				id: source.user.id,
				uuid: response.uuid,
				username: response.ign,
				partyId: source.user.id,
			},
		});

		await prisma.$transaction([createParty, createUser]);

		return `You have successfully registered with the username **${escapeMarkdown(
			response.ign,
		)}**.`;
	}

	public async catch(
		error: Error,
		source: CommandSource,
		response: AuthResponseSuccess<AuthCodeResponse>,
	): CommandResponse {
		throw `The username **${escapeMarkdown(response.ign)}** is already taken.`;
	}
}