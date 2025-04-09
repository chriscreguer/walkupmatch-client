import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { WalkupSongService } from '../services/walkupSongs/walkupSongService.js';
import mongoose from 'mongoose';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local
const envPath = join(__dirname, '..', '..', '.env.local');
console.log(`Loading environment variables from: ${envPath}`);

const result = config({ path: envPath });
if (result.error) {
  console.error('Error loading .env.local file:', result.error);
  process.exit(1);
}

// Verify environment variables
const requiredEnvVars = ['MONGO_URI'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars.join(', '));
  console.error('Please ensure .env.local file exists and contains all required variables');
  process.exit(1);
}

interface APISong {
  id: string;
  title: string;
  spotify_id: string;
  artists: string[];
}

interface APIPlayerResponse {
  data: {
    id: string;
    name: string;
    mlb_id: string;
    songs: APISong[];
  };
}

async function main() {
  console.log('Starting Spotify ID update for all songs...');
  
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || '', { dbName: 'test' });
    console.log('Connected to MongoDB test database');

    const service = WalkupSongService.getInstance();
    const players = await service['getAllPlayers']();
    console.log(`Found ${players.length} players to process`);

    let updatedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const player of players) {
      console.log(`\nProcessing player: ${player.playerName}`);
      
      // Fetch latest data from API using the service
      const details = await service['fetchPlayerDetails'](player.playerId) as APIPlayerResponse;
      if (!details?.data?.songs) {
        console.log('No song data available from API, skipping...');
        errorCount++;
        continue;
      }

      // Create a map of song IDs to Spotify IDs from the API response
      const apiSongsMap = new Map(
        details.data.songs.map(song => [String(song.id), song.spotify_id])
      );

      // Update songs that need Spotify IDs
      if (!player.walkupSongs) {
        console.log('No walkup songs found for player, skipping...');
        errorCount++;
        continue;
      }

      let hasUpdates = false;
      const updatedSongs = player.walkupSongs.map(song => {
        const spotifyId = apiSongsMap.get(song.id);
        if (spotifyId && !song.spotifyId) {
          console.log(`Updating Spotify ID for song "${song.songName}": ${spotifyId}`);
          updatedCount++;
          hasUpdates = true;
          return { ...song, spotifyId };
        }
        if (!spotifyId) {
          console.log(`No Spotify ID available for song "${song.songName}"`);
          skippedCount++;
        } else {
          console.log(`Song "${song.songName}" already has Spotify ID: ${song.spotifyId}`);
        }
        return song;
      });

      // Only update if we made changes
      if (hasUpdates) {
        const Player = mongoose.model('Player');
        await Player.updateOne(
          { id: player.playerId },
          { $set: { walkupSongs: updatedSongs } }
        );
        console.log(`Updated ${updatedCount} songs for ${player.playerName}`);
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log('\nUpdate complete!');
    console.log(`Total songs updated with Spotify IDs: ${updatedCount}`);
    console.log(`Total songs without Spotify IDs: ${skippedCount}`);
    console.log(`Total players with errors: ${errorCount}`);
    
    // Close MongoDB connection
    await mongoose.connection.close();
    process.exit(0);
  } catch (error) {
    console.error('Error updating Spotify IDs:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

main(); 