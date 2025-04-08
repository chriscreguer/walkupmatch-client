import { Player, TeamStats } from '../../lib/mlb/types';

// Types for player statistics that would come from a real API
interface HitterStats {
  PA: number; // Plate appearances
  H: number;  // Hits
  AB: number; // At bats
  BB: number; // Walks
  HBP: number; // Hit by pitch
  SF: number; // Sacrifice flies
  TB: number; // Total bases
  R: number;  // Runs scored
}

interface PitcherStats {
  IP: number; // Innings pitched
  ER: number; // Earned runs
  R: number;  // Runs allowed
}

/**
 * Calculate the Pythagorean expectation (expected win-loss percentage)
 * using the formula: (runs scored^2) / (runs scored^2 + runs allowed^2)
 */
export function calculatePythagoreanWinLoss(
  runsScored: number, 
  runsAllowed: number, 
  gamesInSeason: number
): { wins: number; losses: number } {
  const expectedWinPct = Math.pow(runsScored, 2) / (Math.pow(runsScored, 2) + Math.pow(runsAllowed, 2));
  const expectedWins = Math.round(expectedWinPct * gamesInSeason);
  const expectedLosses = gamesInSeason - expectedWins;
  
  return {
    wins: expectedWins,
    losses: expectedLosses
  };
}

/**
 * Calculate team batting average (AVG)
 */
export function calculateTeamAVG(hitterStats: HitterStats[]): number {
  if (hitterStats.length === 0) return 0;
  
  const totalHits = hitterStats.reduce((sum, player) => sum + player.H, 0);
  const totalAtBats = hitterStats.reduce((sum, player) => sum + player.AB, 0);
  
  return totalAtBats === 0 ? 0 : totalHits / totalAtBats;
}

/**
 * Calculate team on-base plus slugging (OPS)
 */
export function calculateTeamOPS(hitterStats: HitterStats[]): number {
  if (hitterStats.length === 0) return 0;
  
  // Calculate on-base percentage (OBP)
  const totalHits = hitterStats.reduce((sum, player) => sum + player.H, 0);
  const totalBB = hitterStats.reduce((sum, player) => sum + player.BB, 0);
  const totalHBP = hitterStats.reduce((sum, player) => sum + player.HBP, 0);
  const totalAB = hitterStats.reduce((sum, player) => sum + player.AB, 0);
  const totalSF = hitterStats.reduce((sum, player) => sum + player.SF, 0);
  
  const obp = (totalHits + totalBB + totalHBP) / (totalAB + totalBB + totalHBP + totalSF);
  
  // Calculate slugging percentage (SLG)
  const totalTB = hitterStats.reduce((sum, player) => sum + player.TB, 0);
  const slg = totalAB === 0 ? 0 : totalTB / totalAB;
  
  // OPS = OBP + SLG
  return obp + slg;
}

/**
 * Calculate team earned run average (ERA)
 */
export function calculateTeamERA(pitcherStats: PitcherStats[]): number {
  if (pitcherStats.length === 0) return 0;
  
  const totalER = pitcherStats.reduce((sum, player) => sum + player.ER, 0);
  const totalIP = pitcherStats.reduce((sum, player) => sum + player.IP, 0);
  
  // ERA = (earned runs / innings pitched) * 9
  return totalIP === 0 ? 0 : (totalER / totalIP) * 9;
}

/**
 * Calculate team stats based on player data from MySportsFeeds
 */
export function calculateTeamStats(
  hitters: Player[], 
  pitchers: Player[]
): TeamStats {
  // League averages
  const LEAGUE_AVG_ERA = 3.90;
  const LEAGUE_AVG_OPS = 0.711;
  const LEAGUE_AVG_RUNS_PER_GAME = 4.55;
  const GAMES_IN_SEASON = 162;

  console.log('Input players:', {
    hitters: hitters.map(p => ({
      name: p.name,
      stats: p.stats
    })),
    pitchers: pitchers.map(p => ({
      name: p.name,
      stats: p.stats
    }))
  });

  // Calculate batting stats for non-pitchers
  const validHitterStats = hitters
    .map(player => player.stats?.batting)
    .filter((stats): stats is NonNullable<typeof stats> => 
      stats !== undefined
    );



  // Calculate pitching stats
  const validPitcherStats = pitchers
    .map(player => player.stats?.pitching)
    .filter((stats): stats is NonNullable<typeof stats> => 
      stats !== undefined
    );



  // Calculate team AVG (batting average)
  const teamAVG = validHitterStats.length > 0
    ? validHitterStats.reduce((sum, stats) => {
        const avg = stats.battingAvg || 0;
        console.log('Adding batting avg:', avg);
        return sum + avg;
      }, 0) / validHitterStats.length
    : 0;

  console.log('Team AVG:', teamAVG);

  // Calculate team OPS (on-base plus slugging)
  const teamOPS = validHitterStats.length > 0
    ? validHitterStats.reduce((sum, stats) => {
        const ops = (stats.onBasePercentage || 0) + (stats.sluggingPercentage || 0);
        console.log('Adding OPS:', ops, 'from', {
          onBasePercentage: stats.onBasePercentage,
          sluggingPercentage: stats.sluggingPercentage
        });
        return sum + ops;
      }, 0) / validHitterStats.length
    : 0;

  console.log('Team OPS:', teamOPS);

  // Calculate team ERA (earned run average)
  const teamERA = validPitcherStats.length > 0
    ? validPitcherStats.reduce((sum, stats) => {
        const era = stats.earnedRunAvg || 0;
        console.log('Adding ERA:', era);
        return sum + era;
      }, 0) / validPitcherStats.length
    : 0;

  console.log('Team ERA:', teamERA);

  // Calculate Runs Scored (RS) based on team OPS relative to league average
  const runsScored = (teamOPS / LEAGUE_AVG_OPS) * LEAGUE_AVG_RUNS_PER_GAME;
  console.log('Estimated Runs Scored per game:', runsScored);

  // Calculate Runs Allowed (RA) based on team ERA relative to league average
  const runsAllowed = (teamERA / LEAGUE_AVG_ERA) * LEAGUE_AVG_RUNS_PER_GAME;
  console.log('Estimated Runs Allowed per game:', runsAllowed);

  // Calculate win percentage using Pythagorean Expectation
  const winPercentage = Math.pow(runsScored, 2) / (Math.pow(runsScored, 2) + Math.pow(runsAllowed, 2));
  console.log('Win Percentage:', winPercentage);

  // Calculate wins and losses
  const wins = Math.round(winPercentage * GAMES_IN_SEASON);
  const losses = GAMES_IN_SEASON - wins;

  return {
    wins,
    losses,
    AVG: teamAVG,
    OPS: teamOPS,
    ERA: teamERA
  };
}