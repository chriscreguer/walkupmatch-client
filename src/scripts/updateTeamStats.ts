import mongoose from 'mongoose';
import { MySportsFeedsService } from '../services/mysportsfeeds/mysportsfeedsService';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Define MongoDB schema for team stats
const teamStatsSchema = new mongoose.Schema({
  teamId: { type: String, required: true, unique: true },
  team: { type: String, required: true },
  gamesPlayed: { type: Number, required: true },
  wins: { type: Number, required: true },
  losses: { type: Number, required: true },
  lastUpdated: { type: Date, default: Date.now }
});

// Get existing model or create new one
let TeamStatsModel: mongoose.Model<any>;

if (mongoose.models.TeamStats) {
  TeamStatsModel = mongoose.models.TeamStats;
} else {
  TeamStatsModel = mongoose.model('TeamStats', teamStatsSchema);
}

async function updateTeamStats() {
  try {
    // Connect to MongoDB
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI environment variable is not set');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    const msfService = MySportsFeedsService.getInstance();
    
    // Update stats for the Tigers using correct team ID format
    const teamStats = await msfService.updateTeamGamesPlayed('det');
    
    if (teamStats) {
      // Store teamStats in the database
      const result = await TeamStatsModel.findOneAndUpdate(
        { teamId: 'det' },
        {
          teamId: 'det',
          team: teamStats.team,
          gamesPlayed: teamStats.gamesPlayed,
          wins: teamStats.wins,
          losses: teamStats.losses,
          lastUpdated: new Date()
        },
        { upsert: true, new: true }
      );

      console.log(`Successfully updated team stats for ${teamStats.team}:`);
      console.log(`- Games Played: ${teamStats.gamesPlayed}`);
      console.log(`- Wins: ${teamStats.wins}`);
      console.log(`- Losses: ${teamStats.losses}`);
      console.log(`- Last Updated: ${result.lastUpdated}`);
    } else {
      console.error('Failed to update team stats');
    }
  } catch (error) {
    console.error('Error updating team stats:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run immediately if called directly
if (require.main === module) {
  console.log('Running team stats update...');
  updateTeamStats()
    .then(() => {
      console.log('Team stats update completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error during team stats update:', error);
      process.exit(1);
    });
}

export { updateTeamStats }; 