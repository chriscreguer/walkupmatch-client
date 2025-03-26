// Available player positions
export type Position = 'SP' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'RP';

// Player information
export interface Player {
  id: string;
  name: string;
  position: Position;
  team: string;
  headshot: string;
  firstName: string;
  lastName: string;
  teamAbbreviation: string;
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
}

// Team data structure
export interface Team {
  name: string;
  players: Player[];
  songs: Song[];
  stats: TeamStats;
}