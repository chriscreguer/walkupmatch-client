// src/lib/walkupSongs/matchingTypes.ts

import { Position, PlayerStats } from '../mlb/types';
import { PlayerWalkupSong } from './types'; // Import the base type

export type TimeFrame = 'short_term' | 'medium_term' | 'long_term';

export interface NormalizedTrack {
    name: string;
    artist: string;
    spotifyId?: string;
    albumId?: string;
    albumName?: string;
    rank?: number;
    timeFrame?: TimeFrame;
}

export interface NormalizedArtist {
    name: string;
    id?: string;
    rank?: number;
    timeFrame?: TimeFrame;
}

export interface NormalizedAlbum {
    id: string;
    name: string;
    artistName: string;
}

export interface MatchResult {
    score: number;
    reason: string;
    details?: string;
    rank?: number;
    timeFrame?: TimeFrame;
}

// Details of a single song's match against user preferences
export interface SongMatchDetails {
    songName: string;
    artistName: string;
    matchScore: number; // Score for this specific song
    matchReason: string;
    rankInfo: string;
    albumArt: string;
    previewUrl?: string | null;
    spotifyId?: string;
}

// Represents a player candidate evaluated during matching
export interface PlayerWithScore {
    player: PlayerWalkupSong; // Holds the original player data (including all songs)
    matchScore: number; // Final combined score for the player (best song + stats bonus)
    originalMatchScore: number; // Score before diversity penalty/adjustments
    matchReason: string; // Reason from the best matching song
    rankInfo: string; // Details from the best matching song
    matchingSongs: SongMatchDetails[]; // Array of all evaluated songs for this player

    // Fields used during team selection process
    scoreForSorting?: number; // Temporary score including diversity boost for ranking candidates
    boostingGenre?: string | null; // Tracks which genre caused a diversity boost
}

// Represents a selected player assigned to a specific position on the team
export interface TeamAssignment {
    candidate: PlayerWithScore;
    assignedPosition: Position;
}