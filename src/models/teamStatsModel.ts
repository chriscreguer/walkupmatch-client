import mongoose from 'mongoose';

// Define MongoDB schema for team stats
const teamStatsSchema = new mongoose.Schema({
  teamId: { type: String, required: true, unique: true },
  team: { type: String, required: true },
  gamesPlayed: { type: Number, required: true },
  wins: { type: Number, required: true },
  losses: { type: Number, required: true },
  lastUpdated: { type: Date, default: Date.now }
});

// Define TypeScript interface for team stats document
interface TeamStatsDocument extends mongoose.Document {
  teamId: string;
  team: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  lastUpdated: Date;
}

// Get existing model or create new one
let TeamStatsModel: mongoose.Model<TeamStatsDocument>;

if (mongoose.models.TeamStats) {
  TeamStatsModel = mongoose.models.TeamStats;
} else {
  TeamStatsModel = mongoose.model<TeamStatsDocument>('TeamStats', teamStatsSchema);
}

export { TeamStatsModel };
export type { TeamStatsDocument }; 