// Available player positions
export type Position = 'SP' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'P1' | 'P2' | 'P3' | 'P4';

// Player statistics from MySportsFeeds
export interface PlayerStats {
  batting?: {
    battingAvg: number;
    onBasePercentage: number;
    sluggingPercentage: number;
    plateAppearances: number;
  };
  pitching?: {
    earnedRunAvg: number;
    inningsPitched: number;
  };
}

// Player information
export interface Player {
  id: string;
  name: string;
  firstName: string;
  lastName: string;
  position: Position;
  team: string;
  teamAbbreviation: string;
  headshot: string;
  stats?: PlayerStats;
  matchingSongs?: Array<{
    songName: string;
    artistName: string;
    matchScore: number;
    matchReason: string;
    rankInfo: string;
    albumArt: string;
    previewUrl?: string | null;
  }>;
}

// Team statistics
export interface TeamStats {
  wins: number;
  losses: number;
  OPS: number;
  AVG: number;
  ERA: number;
}

// Song information
export interface Song {
  id: string;
  name: string;
  artist: string;
  albumArt: string;
  playerMatch: string;
  matchScore: number; // 0-3 representing match strength
  matchReason: string; // e.g. "In your top songs", "Matches your genre preferences", etc.
  rankInfo?: string; // e.g. "#4 in your top tracks"
  previewUrl?: string | null; // Spotify preview URL for 30-second sample
}

// Team data structure
export interface Team {
  name: string;
  players: Player[];
  songs: Song[];
  stats: TeamStats;
}