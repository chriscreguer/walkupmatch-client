import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { WalkupSongService } from '@/services/walkupSongs/walkupSongService';

// Get the directory name of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local
config({ path: join(__dirname, '..', '..', '.env.local') });

async function main() {
  console.log('Starting walkup song data update...');
  
  if (!process.env.MONGO_URI) {
    console.error('MONGO_URI environment variable is not set');
    process.exit(1);
  }
  
  try {
    const service = WalkupSongService.getInstance();
    await service['updatePlayerData'](); // Access private method for initial setup
    console.log('Walkup song data update completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error updating walkup song data:', error);
    process.exit(1);
  }
}

main(); 