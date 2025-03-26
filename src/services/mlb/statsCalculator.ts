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
 * Calculate expected team stats based on the provided spec
 */
export function calculateTeamStats(
  hitters: Player[], 
  pitchers: Player[],
  mlbAverages = {
    gamesPlayed: 162,
    teamPAPerGame: 38,
    teamIPPerGame: 9
  }
): TeamStats {
  // In a real implementation, we would fetch each player's stats from an API
  // For now, we'll use mock stats just to demonstrate the calculation logic
  
  // Mock hitter stats (in a real app, these would come from an API)
  const mockHitterStats: HitterStats[] = hitters.map(() => ({
    PA: 650,
    H: 172,
    AB: 600,
    BB: 40,
    HBP: 5,
    SF: 5,
    TB: 280,
    R: 85
  }));
  
  // Mock pitcher stats (in a real app, these would come from an API)
  const mockPitcherStats: PitcherStats[] = pitchers.map(() => ({
    IP: 180,
    ER: 70,
    R: 75
  }));
  
  // Calculate runs scored per plate appearance
  const totalRunsScored = mockHitterStats.reduce((sum, player) => sum + player.R, 0);
  const totalPA = mockHitterStats.reduce((sum, player) => sum + player.PA, 0);
  const runsPerPA = totalPA === 0 ? 0 : totalRunsScored / totalPA;
  
  // Calculate runs allowed per inning pitched
  const totalRunsAllowed = mockPitcherStats.reduce((sum, player) => sum + player.R, 0);
  const totalIP = mockPitcherStats.reduce((sum, player) => sum + player.IP, 0);
  const runsPerIP = totalIP === 0 ? 0 : totalRunsAllowed / totalIP;
  
  // Estimate team runs scored for a full season
  const projectedRunsScored = runsPerPA * mlbAverages.teamPAPerGame * mlbAverages.gamesPlayed;
  
  // Estimate team runs allowed for a full season
  const projectedRunsAllowed = runsPerIP * mlbAverages.teamIPPerGame * mlbAverages.gamesPlayed;
  
  // Calculate pythagorean win-loss
  const { wins, losses } = calculatePythagoreanWinLoss(
    projectedRunsScored,
    projectedRunsAllowed,
    mlbAverages.gamesPlayed
  );
  
  // Calculate other stats
  const teamAVG = calculateTeamAVG(mockHitterStats);
  const teamOPS = calculateTeamOPS(mockHitterStats);
  const teamERA = calculateTeamERA(mockPitcherStats);
  
  return {
    wins,
    losses,
    AVG: teamAVG,
    OPS: teamOPS,
    ERA: teamERA
  };
}