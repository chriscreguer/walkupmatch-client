import mongoose from 'mongoose';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import SpotifyWebApi from 'spotify-web-api-node';
import { Player } from '../models/playerModel'; // Adjust path to your Player model
// If Player model isn't separate, import it from walkupSongService path but ensure it's the actual model

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
const requiredEnvVars = ['MONGO_URI', 'SPOTIFY_CLIENT_ID', 'SPOTIFY_CLIENT_SECRET'];
const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error('Missing required environment variables:', missingVars.join(', '));
  console.error('Please ensure .env.local file exists and contains all required variables');
  process.exit(1);
}

// --- Configuration ---
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const SPOTIFY_CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const MONGO_URI = process.env.MONGO_URI;
const TRACK_DETAILS_BATCH_SIZE = 50; // Max IDs for /tracks endpoint
const ARTIST_DETAILS_BATCH_SIZE = 50; // Max IDs for /artists endpoint
const DB_UPDATE_BATCH_SIZE = 100; // How many songs to prep before writing to DB
const DELAY_BETWEEN_SPOTIFY_BATCHES = 1000; // 1 second delay between Spotify API batches
const DELAY_BETWEEN_DB_BATCHES = 500; // 0.5 second delay between DB write batches

// --- Helper Function ---
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// --- Spotify API Setup ---
const spotifyApi = new SpotifyWebApi({
  clientId: SPOTIFY_CLIENT_ID,
  clientSecret: SPOTIFY_CLIENT_SECRET,
});

async function getSpotifyAppToken() {
  try {
    const data = await spotifyApi.clientCredentialsGrant();
    console.log('Spotify token expires in ' + data.body['expires_in']);
    spotifyApi.setAccessToken(data.body['access_token']);
    console.log('Successfully retrieved Spotify app token.');
    return true;
  } catch (error) {
    console.error('Error retrieving Spotify app token:', error);
    return false;
  }
}

interface Song {
  id: string;
  spotifyId?: string;
  genre?: string[];
}

interface PlayerDocument {
  _id: mongoose.Types.ObjectId;
  walkupSongs?: Song[];
}

// --- Main Logic ---
async function updateMissingGenres() {
  console.log('Starting genre update script...');

  if (!MONGO_URI) {
    console.error('MONGO_URI not found in environment variables.');
    process.exit(1);
  }
  if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET) {
    console.error('Spotify Client ID or Secret not found in environment variables.');
    process.exit(1);
  }

  // Connect to MongoDB
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB.');
  } catch (error) {
    console.error('MongoDB connection error:', error);
    process.exit(1);
  }

  // Authenticate with Spotify
  const tokenSuccess = await getSpotifyAppToken();
  if (!tokenSuccess) {
    await mongoose.disconnect();
    process.exit(1);
  }

  let songsProcessed = 0;
  let songsUpdated = 0;
  const trackIdsToFetch = new Set<string>();
  const trackIdToPlayerSongRef = new Map<string, { playerId: mongoose.Types.ObjectId, songId: string }>(); // songId is the walkupdb ID

  try {
    // 1. Find Players with Songs missing Genres
    console.log('Finding players and songs missing genre data...');
    const players = await Player.find({
      'walkupSongs.spotifyId': { $exists: true, $ne: '', $ne: null }, // Has valid Spotify ID
      $or: [
        { 'walkupSongs.genre': { $exists: false } }, // Find if field is missing
        { 'walkupSongs.genre': { $size: 0 } }      // OR if field is an empty array
      ]
    }).select('_id walkupSongs.id walkupSongs.spotifyId walkupSongs.genre');

    console.log(`Found ${players.length} players with potential songs missing genres.`);

    // Collect unique Spotify Track IDs and references
    players.forEach((player: PlayerDocument) => {
      player.walkupSongs?.forEach((song: Song) => {
        if (song.spotifyId && (!song.genre || song.genre.length === 0)) {
          if (!trackIdsToFetch.has(song.spotifyId)) {
            trackIdsToFetch.add(song.spotifyId);
            trackIdToPlayerSongRef.set(song.spotifyId, { playerId: player._id, songId: song.id });
          }
        }
      });
    });

    const uniqueTrackIds = Array.from(trackIdsToFetch);
    console.log(`Found ${uniqueTrackIds.length} unique songs needing genre check.`);

    if (uniqueTrackIds.length === 0) {
      console.log('No songs require genre updates.');
      await mongoose.disconnect();
      console.log('Disconnected from MongoDB.');
      return;
    }

    const trackIdToGenresMap = new Map<string, string[]>();

    // 2. Process Track IDs in Batches to get Artist IDs
    console.log('Fetching track details to get artist IDs...');
    for (let i = 0; i < uniqueTrackIds.length; i += TRACK_DETAILS_BATCH_SIZE) {
      const trackBatch = uniqueTrackIds.slice(i, i + TRACK_DETAILS_BATCH_SIZE);
      try {
        console.log(`Processing track batch ${i / TRACK_DETAILS_BATCH_SIZE + 1}...`);
        const trackDetails = await spotifyApi.getTracks(trackBatch);
        const artistIdsToFetch = new Set<string>();
        const trackIdToArtistIdMap = new Map<string, string>(); // Map track ID to its primary artist ID

        trackDetails.body.tracks.forEach(track => {
          if (track && track.artists && track.artists.length > 0) {
            const primaryArtistId = track.artists[0].id;
            if (primaryArtistId) {
                artistIdsToFetch.add(primaryArtistId);
                trackIdToArtistIdMap.set(track.id, primaryArtistId);
            }
          }
        });

        // 3. Fetch Artist Genres for the unique artists in this batch
        const uniqueArtistIds = Array.from(artistIdsToFetch);
        if (uniqueArtistIds.length > 0) {
            console.log(`Workspaceing genres for ${uniqueArtistIds.length} unique artists in batch...`);
            const artistIdToGenresMap = new Map<string, string[]>();
             for (let j = 0; j < uniqueArtistIds.length; j += ARTIST_DETAILS_BATCH_SIZE) {
                 const artistBatch = uniqueArtistIds.slice(j, j + ARTIST_DETAILS_BATCH_SIZE);
                  try {
                     const artistDetails = await spotifyApi.getArtists(artistBatch);
                     artistDetails.body.artists.forEach(artist => {
                         if (artist) {
                            artistIdToGenresMap.set(artist.id, artist.genres || []);
                         }
                     });
                  } catch (artistError) {
                     console.error(`Failed to fetch details for artist batch starting with ${artistBatch[0]}:`, artistError);
                     // Decide: continue or stop? Let's continue and skip these artists' genres
                  }
                   if (j + ARTIST_DETAILS_BATCH_SIZE < uniqueArtistIds.length) {
                       await delay(DELAY_BETWEEN_SPOTIFY_BATCHES); // Delay between artist batches if needed
                   }
             }


            // Populate the main trackId -> genres map
            trackIdToArtistIdMap.forEach((artistId, trackId) => {
              trackIdToGenresMap.set(trackId, artistIdToGenresMap.get(artistId) || []);
            });
        }

      } catch (trackError) {
        console.error(`Failed to fetch details for track batch starting with ${trackBatch[0]}:`, trackError);
        // Decide: continue or stop script? Let's continue to next batch
      }

      songsProcessed += trackBatch.length;
      console.log(`Processed ${songsProcessed}/${uniqueTrackIds.length} songs so far.`);
      if (i + TRACK_DETAILS_BATCH_SIZE < uniqueTrackIds.length) {
        await delay(DELAY_BETWEEN_SPOTIFY_BATCHES); // Delay between track batches
      }
    } // End of track batch loop

    // 4. Prepare and Execute Database Updates in Batches
    console.log('Preparing database updates...');
    const bulkOps: mongoose.mongo.AnyBulkWriteOperation[] = [];

    for (const [trackId, genres] of trackIdToGenresMap.entries()) {
      const hasGenres = genres && genres.length > 0;
      if (hasGenres) {
        bulkOps.push({
          updateOne: {
            filter: { "walkupSongs.spotifyId": trackId },
            update: { $set: { "walkupSongs.$[song].genre": genres } },
            arrayFilters: [
              {
                "song.spotifyId": trackId,
                $or: [
                  { "song.genre": { $size: 0 } },
                  { "song.genre": { $exists: false } }
                ]
              }
            ]
          }
        });
        songsUpdated++;
      } else {
        console.log(`No genres found for track ID ${trackId}, skipping DB update.`);
      }

      if (bulkOps.length >= DB_UPDATE_BATCH_SIZE) {
        console.log(`Executing DB update batch of ${bulkOps.length}...`);
        try {
          await Player.bulkWrite(bulkOps);
          console.log('DB batch written successfully.');
        } catch (dbError) {
          console.error('Error executing DB bulkWrite:', dbError);
        }
        bulkOps.length = 0;
        await delay(DELAY_BETWEEN_DB_BATCHES);
      }
    }

    if (bulkOps.length > 0) {
      console.log(`Executing final DB update batch of ${bulkOps.length}...`);
      try {
        await Player.bulkWrite(bulkOps);
        console.log('Final DB batch written successfully.');
      } catch (dbError) {
        console.error('Error executing final DB bulkWrite:', dbError);
      }
    }

    console.log(`Genre update script finished. Processed: ${songsProcessed}. Updated: ${songsUpdated}.`);

  } catch (error) {
    console.error('An error occurred during the genre update process:', error);
  } finally {
    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB.');
  }
}

// Run the script
updateMissingGenres();