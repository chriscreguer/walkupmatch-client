import mongoose from 'mongoose';
import { Player } from '@/models/playerModel';
import dotenv from 'dotenv';

// Load environment variables from .env.local
dotenv.config({ path: '.env.local' });

async function cleanupLegacyFields() {
    try {
        // Connect to MongoDB
        if (!process.env.MONGO_URI) {
            throw new Error('MONGO_URI environment variable is not set');
        }
        console.log('Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB successfully');

        // Remove legacy walkupSong field
        console.log('Removing legacy walkupSong field...');
        const walkupSongResult = await Player.updateMany(
            {},
            { $unset: { walkupSong: "" } }
        );
        console.log(`Removed walkupSong field from ${walkupSongResult.modifiedCount} documents`);

        // Remove legacy artistName field from walkupSongs subdocuments
        console.log('Removing legacy artistName field from walkupSongs...');
        const artistNameResult = await Player.updateMany(
            {},
            { $unset: { "walkupSongs.$[].artistName": "" } }
        );
        console.log(`Removed artistName field from ${artistNameResult.modifiedCount} documents`);

        console.log('Cleanup completed successfully');
    } catch (error) {
        console.error('Error during cleanup:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

// Run the cleanup
cleanupLegacyFields().catch(console.error); 