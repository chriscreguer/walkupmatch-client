// src/models/playerModel.ts
import mongoose from 'mongoose';
import { PlayerStats } from '../lib/mlb/types'; // Assuming PlayerStats type is defined here or adjust path

// Define TypeScript interface for WalkupSong subdocument
export interface WalkupSongSubdocument {
    id: string;
    songName: string;
    // artistName: string; // REMOVED
    artists: Array<{ name: string; role: 'primary' | 'featured' }>; // Keep structured array
    albumName?: string; // Made optional
    spotifyId?: string;
    youtubeId?: string;
    genre?: string[];
    albumArt?: string;
    previewUrl?: string | null;
}

// Define TypeScript interface for MongoDB document
export interface PlayerDocument extends mongoose.Document {
    id: string; // WalkupDB API ID
    mlbId: string; // MLB Stats API ID (or MySportsFeeds ID)
    name: string;
    position: string;
    team: string;
    teamId: string;
    lastUpdated: Date;
    stats?: PlayerStats; // Use the imported PlayerStats type
    walkupSongs: mongoose.Types.DocumentArray<WalkupSongSubdocument>; // Array of songs
    // Removed legacy fields
    matchReason?: string;
    rankInfo?: string;
    matchScore?: number;
}

const playerSchema = new mongoose.Schema<PlayerDocument>({
    id: { type: String, required: true, unique: true, index: true }, // WalkupDB API ID
    mlbId: { type: String, required: true, index: true }, // External stats API ID
    name: { type: String, required: true },
    position: { type: String, required: true },
    team: { type: String, required: true },
    teamId: { type: String, required: true }, // Abbreviation or ID from API
    lastUpdated: { type: Date, default: Date.now },
    stats: {
        _id: false,
        batting: {
            _id: false,
            battingAvg: Number,
            onBasePercentage: Number,
            sluggingPercentage: Number,
            plateAppearances: Number
        },
        pitching: {
            _id: false,
            earnedRunAvg: Number,
            inningsPitched: Number
        }
    },
    walkupSongs: [{
        _id: false,
        id: { type: String, required: true },
        songName: { type: String, required: true },
        // artistName: { type: String, required: true }, // REMOVED
        artists: [{ // Structured artist info
            _id: false,
            name: { type: String, required: true },
            role: { type: String, enum: ['primary', 'featured'], required: true }
        }],
        albumName: { type: String, default: '' },
        spotifyId: { type: String, default: '', index: true },
        youtubeId: { type: String, default: '' },
        genre: { type: [String], default: [] },
        albumArt: { type: String, default: '' },
        previewUrl: { type: String, default: null }
    }]
});

// Add other indexes if needed
playerSchema.index({ teamId: 1 });
playerSchema.index({ position: 1 });

// Get existing model or create new one
export const Player = mongoose.models.Player || mongoose.model<PlayerDocument>('Player', playerSchema);