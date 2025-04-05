import mongoose from 'mongoose';
import { MySportsFeedsService } from '@/services/mysportsfeeds/mysportsfeedsService';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Define MongoDB schema for player data
const playerSchema = new mongoose.Schema({
  id: { type: String, required: true },
  mlbId: { type: String, required: true },
  name: { type: String, required: true },
  position: { type: String, required: true },
  team: { type: String, required: true },
  teamId: { type: String, required: true },
  walkupSong: {
    id: { type: String, required: true },
    songName: { type: String, required: true },
    artistName: { type: String, required: true },
    albumName: String,
    spotifyId: String,
    youtubeId: String,
    genre: [String],
    albumArt: String
  },
  matchReason: String,
  rankInfo: String,
  matchScore: Number,
  lastUpdated: { type: Date, default: Date.now },
  stats: {
    batting: {
      battingAvg: Number,
      onBasePercentage: Number,
      sluggingPercentage: Number,
      plateAppearances: Number
    },
    pitching: {
      earnedRunAvg: Number,
      inningsPitched: Number
    }
  }
});

interface PlayerDocument {
  id: string;
  mlbId: string;
  name: string;
  position: string;
  team: string;
  teamId: string;
  walkupSong: {
    id: string;
    songName: string;
    artistName: string;
    albumName?: string;
    spotifyId?: string;
    youtubeId?: string;
    genre: string[];
    albumArt?: string;
  };
  matchReason?: string;
  rankInfo?: string;
  matchScore?: number;
  lastUpdated: Date;
  stats: {
    batting: {
      battingAvg: number;
      onBasePercentage: number;
      sluggingPercentage: number;
      plateAppearances: number;
    };
    pitching: {
      earnedRunAvg: number;
      inningsPitched: number;
    };
  };
}

// Get existing model or create new one
let PlayerModel: mongoose.Model<PlayerDocument>;

if (mongoose.models.Player) {
  PlayerModel = mongoose.models.Player;
} else {
  PlayerModel = mongoose.model<PlayerDocument>('Player', playerSchema);
}

async function enrichPlayerData() {
  try {
    // Connect to MongoDB
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI environment variable is not set');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB');

    // Initialize MySportsFeeds service
    const msfService = MySportsFeedsService.getInstance();

    // Get all players from MongoDB
    const players = await PlayerModel.find({});
    console.log(`Found ${players.length} players to enrich`);

    // Fetch ALL player data in a single API call
    console.log("Fetching all player data from MySportsFeeds API in a single request...");
    const playerMaps = await msfService.fetchAllPlayerData();
    console.log(`Retrieved data for ${playerMaps.allPlayers.length} players`);

    let successCount = 0;
    let failureCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;

    // Process all players using name-based matching
    for (const player of players) {
      try {
        console.log(`\nProcessing player: ${player.name} (MLB ID: ${player.mlbId})`);
        console.log('Current data:', {
          position: player.position,
          team: player.team,
          teamId: player.teamId,
          stats: player.stats
        });

        // Use the map-based enrichment with name matching
        const enrichedPlayer = await msfService.enrichPlayerData(player, playerMaps);
        
        console.log('Enriched data:', {
          position: enrichedPlayer.position,
          team: enrichedPlayer.team,
          teamId: enrichedPlayer.teamId,
          stats: enrichedPlayer.stats
        });

        // Check if data actually changed
        const hasChanges = 
          enrichedPlayer.position !== player.position ||
          enrichedPlayer.team !== player.team ||
          enrichedPlayer.teamId !== player.teamId ||
          JSON.stringify(enrichedPlayer.stats) !== JSON.stringify(player.stats);

        if (hasChanges) {
          console.log('Updating player with new data...');
          const result = await PlayerModel.updateOne(
            { id: player.id },
            {
              $set: {
                position: enrichedPlayer.position,
                team: enrichedPlayer.team,
                teamId: enrichedPlayer.teamId,
                stats: enrichedPlayer.stats,
                lastUpdated: new Date()
              }
            }
          );
          
          if (result.modifiedCount > 0) {
            successCount++;
          } else {
            skippedCount++;
          }
        } else {
          console.log('No changes needed for this player');
          skippedCount++;
        }
        
        // If the player wasn't found in the name matching
        if (enrichedPlayer.position === player.position && 
            player.position === 'Unknown') {
          console.log(`Player ${player.name} not matched in MySportsFeeds data`);
          notFoundCount++;
        }
        
      } catch (error) {
        console.error(`Error processing player ${player.name}:`, error);
        failureCount++;
      }
    }

    console.log('\nPlayer data enrichment completed');
    console.log('Summary:', {
      totalPlayers: players.length,
      successfulUpdates: successCount,
      failedUpdates: failureCount,
      skippedUpdates: skippedCount,
      notFoundInAPI: notFoundCount
    });
  } catch (error) {
    console.error('Error in enrichPlayerData:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the script if called directly
if (require.main === module) {
  enrichPlayerData();
}

export { enrichPlayerData };