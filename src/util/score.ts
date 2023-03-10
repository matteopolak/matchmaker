import { Game, Mode, Profile } from '@prisma/client';

import { prisma } from '$/database';

import { computeEloChange, GameResult, GameUserWithProfile, GlickoCalculation, muToRating } from './elo';
import { iter } from './iter';

export type GameWithModeNameAndPlayersWithProfiles = Game & {
	users: GameUserWithProfile[];
	mode: Mode;
}

export async function scoreGame(game: GameWithModeNameAndPlayersWithProfiles, result: GameResult.TIE, winnerIdx?: number): Promise<[Map<number, GlickoCalculation>, Profile[]]>;
export async function scoreGame(game: GameWithModeNameAndPlayersWithProfiles, result: GameResult.WIN, winnerIdx: number): Promise<[Map<number, GlickoCalculation>, Profile[]]>;
export async function scoreGame(game: GameWithModeNameAndPlayersWithProfiles, result: GameResult, winnerIdx?: number): Promise<[Map<number, GlickoCalculation>, Profile[]]> {
	const scores = result === GameResult.TIE ? computeEloChange(game.users, game.mode, result) : computeEloChange(game.users, game.mode, result, winnerIdx!);

	return [
		scores,
		await prisma.$transaction(
			iter(game.users)
				.map(p => {
					const winner = p.team === winnerIdx;
					const score = scores.get(p.userId);
					if (!score) return undefined!;

					const rating = muToRating(score.mu);

					return prisma.profile.upsert({
						where: {
							modeId_userId: {
								modeId: game.modeId,
								userId: p.userId,
							},
						},
						update: {
							[winner ? 'wins' : 'losses']: {
								increment: 1,
							},
							[winner ? 'winstreak' : 'losestreak']: {
								increment: 1,
							},
							[winner ? 'losestreak' : 'winstreak']: 0,
							phi: score.phi,
							mu: {
								increment: score.mu,
							},
							rv: score.rv,
							rating,
						},
						create: {
							modeId: game.modeId,
							userId: p.userId,
							[winner ? 'wins' : 'losses']: 1,
							[winner ? 'winstreak' : 'losestreak']: 1,
							phi: score.phi,
							mu: score.mu,
							rv: score.rv,
							rating,
						},
					});
				})
				.filter(p => p !== undefined)
				.toArray()
		),
	];
}
