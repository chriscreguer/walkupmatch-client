import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { WalkupSongService } from '../services/walkupSongs/walkupSongService.js';

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

async function main() {
  console.log('Starting walkup song data update...');
  
  try {
    const service = WalkupSongService.getInstance();
    await service['updatePlayerData']();
    console.log('Walkup song data update completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('Error updating walkup song data:', error);
    process.exit(1);
  }
}

main(); 