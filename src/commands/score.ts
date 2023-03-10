import {
	Argument,
	ArgumentType,
	Command,
	CommandOptions,
	CommandSource,
	embed,
	EventHandler,
	message,
} from '@matteopolak/framecord';
import { channels } from 'config';
import { prisma } from 'database';
import { Attachment, ChannelType, Interaction } from 'discord.js';

import { GameManager, GameState } from '$/managers/game';
import { createTeamButtons } from '$/util/components';
import { GameResult } from '$/util/elo';
import { playersToFields } from '$/util/message';
import { scoreGame } from '$/util/score';

export default class ScoreCommand extends Command {
	constructor(options: CommandOptions) {
		super(options);

		this.description = 'Sends a game to be scored.';
		this.arguments.push(
			new Argument({
				type: ArgumentType.Attachment,
				name: 'proof',
				description: 'A screenshot of the game results',
			})
		);
	}

	public async run(source: CommandSource, proof: Attachment) {
		const game = await prisma.game.findFirst({
			where: {
				textChannelId: source.channelId,
			},
			include: {
				users: {
					include: {
						user: true,
					},
				},
				mode: true,
			},
		});

		if (game === null) throw 'This command can only be run in a game channel.';
		if (game.state < GameState.ACTIVE)
			throw 'You can only score the game after it has started.';

		const scoring = this.client.channels.cache.get(channels.scoring.channelId);
		if (!scoring || scoring.type !== ChannelType.GuildText)
			throw 'The scoring channel has not been set up. Please try again later.';

		await prisma.game.update({
			where: {
				id: game.id,
			},
			data: {
				state: GameState.SCORING,
			},
		});

		message(scoring, {
			embeds: embed({
				title: `Game \`#${game.id}\``,
				description: `Submitted by ${source.user}`,
				fields: playersToFields(game.users),
				image: {
					url: proof.url,
				},
			}).embeds,
			components: createTeamButtons(game.mode.teams, game.id),
		});

		return void GameManager.close(
			game,
			source.guild,
			source.channel!,
			'The game has been sent to be scored.'
		);
	}

	private async getModeFromGameId(gameId: number) {
		const game = await prisma.game.findFirst({
			where: {
				id: gameId,
			},
			select: {
				mode: true,
			},
		});

		return game?.mode ?? null;
	}

	@EventHandler()
	public async interactionCreate(interaction: Interaction) {
		if (!interaction.isButton()) return;

		const [key, gameIdString, teamIndexString] =
			interaction.customId.split('.');

		const isTie = key === 'tie';
		if (!isTie && key !== 'team') return;

		const teamIndex = isTie ? 0 : parseInt(teamIndexString);
		const gameId = parseInt(gameIdString);

		const mode = await this.getModeFromGameId(gameId);
		if (mode === null) return;

		const game = await prisma.game.findFirst({
			where: {
				id: gameId,
			},
			include: {
				mode: true,
				users: {
					include: {
						user: {
							include: {
								profiles: {
									where: {
										modeId: mode.id,
									},
								},
							},
						},
					},
				},
			},
		});

		if (game === null) return;

		const [score] = isTie ? await scoreGame(game, GameResult.TIE) : await scoreGame(game, GameResult.WIN, teamIndex);
		const scoring = this.client.channels.cache.get(channels.scoring.channelId);

		if (scoring?.isTextBased()) {
			message(scoring, {
				embeds: embed({
					title: `Game \`#${game.id}\``,
					description: `Submitted by ${interaction.user}`,
					fields: playersToFields(game.users, teamIndex, score),
					image: {
						url: game.proof!,
					},
				}).embeds,
			});
		}

		await interaction.message.delete();
	}
}
