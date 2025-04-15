import mongoose from 'mongoose';
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { Player, PlayerDocument, WalkupSongSubdocument } from '../models/playerModel.js';

// Load environment variables from .env.local
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '../../.env.local') });

interface BulkWriteOperation {
  updateOne: {
    filter: { _id: mongoose.Types.ObjectId };
    update: { $set: { walkupSongs: WalkupSongSubdocument[] } };
  };
}

async function removeWalkupSongField() {
  try {
    console.log('Removing walkupSong field from all documents...');
    const result = await Player.updateMany(
      {},
      { $unset: { walkupSong: "" } }
    );
    console.log(`Removed walkupSong field from ${result.modifiedCount} documents`);
  } catch (error) {
    console.error('Error removing walkupSong field:', error);
    throw error;
  }
}

async function dedupeWalkupSongs() {
  try {
    if (!process.env.MONGO_URI) {
      throw new Error('MONGO_URI environment variable is not set');
    }
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB for deduplication');

    // First, remove the walkupSong field
    await removeWalkupSongField();

    const BATCH_SIZE = 100;
    let processedCount = 0;
    let totalDuplicatesRemoved = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const players = await Player.find({})
          .skip(processedCount)
          .limit(BATCH_SIZE);

        if (players.length === 0) {
          hasMore = false;
          break;
        }

        const bulkOps = players.map((player: PlayerDocument) => {
          if (player.walkupSongs && Array.isArray(player.walkupSongs)) {
            const uniqueSongsMap = new Map<string, WalkupSongSubdocument>();
            const originalCount = player.walkupSongs.length;

            for (const song of player.walkupSongs) {
              const key = song.id && song.id !== 'no-song'
                ? song.id
                : `${song.songName.toLowerCase()}|${song.artists.map(a => a.name).join(', ').toLowerCase()}`;
              if (!uniqueSongsMap.has(key)) {
                uniqueSongsMap.set(key, song);
              }
            }

            const dedupedSongs = Array.from(uniqueSongsMap.values());
            const duplicatesRemoved = originalCount - dedupedSongs.length;

            if (duplicatesRemoved > 0) {
              totalDuplicatesRemoved += duplicatesRemoved;
              return {
                updateOne: {
                  filter: { _id: player._id },
                  update: { $set: { walkupSongs: dedupedSongs } }
                }
              } as BulkWriteOperation;
            }
          }
          return null;
        }).filter((op: BulkWriteOperation | null): op is BulkWriteOperation => op !== null);

        if (bulkOps.length > 0) {
          await Player.bulkWrite(bulkOps);
        }

        processedCount += players.length;
        console.log(`Processed ${processedCount} players. Removed ${totalDuplicatesRemoved} duplicates so far.`);
      } catch (batchError) {
        console.error(`Error processing batch starting at ${processedCount}:`, batchError);
        // Continue with next batch
        processedCount += BATCH_SIZE;
      }
    }

    console.log(`Deduplication complete. Total duplicates removed: ${totalDuplicatesRemoved}`);
  } catch (error) {
    console.error('Error during deduplication:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

dedupeWalkupSongs();
