// src/lib/walkupSongs/matchingTypes.ts
// (Combine relevant interfaces from old service/types files here)

import { Position, PlayerStats } from '../mlb/types';
import { PlayerWalkupSong } from './types'; // Base type

export type TimeFrame = 'short_term' | 'medium_term' | 'long_term';

export interface NormalizedTrack {
    name: string;
    artist: string; // Primary artist name, normalized
    spotifyId?: string;
    albumId?: string;
    albumName?: string;
    rank?: number;
    timeFrame?: TimeFrame;
}

export interface NormalizedArtist {
    name: string; // Normalized name
    id?: string;
    rank?: number;
    timeFrame?: TimeFrame;
}

export interface NormalizedAlbum {
    id: string;
    name: string;
    artistName: string;
}

// Result of matching a single aspect (Song, Artist, Genre)
export interface MatchResult {
    score: number;
    reason: string;
    details?: string;
    rank?: number; // Rank if applicable (Top Song/Artist)
    timeFrame?: TimeFrame; // Time frame if applicable
}

// Details of a single player song's match against user preferences
export interface SongMatchDetails {
    songName: string;
    // artistName: string; // Use artists array instead
    artists: Array<{ name: string; role: 'primary' | 'featured' }>; // Store structured artists
    matchScore: number; // Combined score for this specific song
    matchReason: string; // Primary reason for the score
    rankInfo: string; // Details like rank/timeframe
    albumArt: string;
    previewUrl?: string | null;
    spotifyId?: string;
}

// Represents a player candidate evaluated during matching
export interface PlayerWithScore {
    player: PlayerWalkupSong; // Holds the original player data
    matchScore: number; // Final combined score (best song + stats bonus)
    originalMatchScore: number; // Score before penalties/boosts for sorting
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