// Available player positions
export type Position = 'SP' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF' | 'DH' | 'RP';

// Player information
export interface Player {
  id: string;
  name: string;
  position: Position;
  team: string;
  imageUrl: string;
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
}

// Team data structure
export interface Team {
  name: string;
  players: Player[];
  songs: Song[];
  stats: TeamStats;
}