// src/models/playerModel.ts
import mongoose from 'mongoose';
import { PlayerStats } from '../lib/mlb/types'; // Assuming PlayerStats type is defined here or adjust path

// Define TypeScript interface for WalkupSong subdocument
interface WalkupSongSubdocument {
    id: string;
    songName: string;
    artistName: string;
    artists: Array<{ name: string; role: 'primary' | 'featured' }>;
    albumName: string;
    spotifyId?: string;
    youtubeId?: string;
    genre: string[];
    albumArt?: string;
    previewUrl?: string | null; // Added previewUrl here as well
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

    // Optional fields from previous schema if still needed, but likely handled elsewhere now
    // matchReason?: string;
    // rankInfo?: string;
    // matchScore?: number;
}


const playerSchema = new mongoose.Schema<PlayerDocument>({
    id: { type: String, required: true, unique: true, index: true }, // WalkupDB API ID
    mlbId: { type: String, required: true, index: true }, // External stats API ID
    name: { type: String, required: true },
    position: { type: String, required: true },
    team: { type: String, required: true },
    teamId: { type: String, required: true }, // Abbreviation or ID from API
    lastUpdated: { type: Date, default: Date.now },
    stats: { // Embed the stats structure
        _id: false, // Don't create a separate ID for stats object
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
    walkupSongs: [{ // Array of walkup songs
        _id: false, // Disable auto-generated _id for subdocuments
        id: { type: String, required: true }, // WalkupDB Song ID
        songName: { type: String, required: true },
        artistName: { type: String, required: true }, // Keep original combined string if needed
        artists: [{ // Structured artist info
            _id: false,
            name: { type: String, required: true },
            role: { type: String, enum: ['primary', 'featured'], required: true }
        }],
        albumName: { type: String, default: '' },
        spotifyId: { type: String, default: '', index: true }, // Index for potential lookups
        youtubeId: { type: String, default: '' },
        genre: { type: [String], default: [] },
        albumArt: { type: String, default: '' },
        previewUrl: { type: String, default: null } // Store preview URL if available
    }]
    // Optional fields removed from here, they relate to matching results, not core player data
});

// Ensure indexes for potentially queried fields
playerSchema.index({ teamId: 1 });
playerSchema.index({ position: 1 });
playerSchema.index({ name: 1 }); // If searching by name


// Get existing model or create new one
export const Player = mongoose.models.Player || mongoose.model<PlayerDocument>('Player', playerSchema);