import cron from 'node-cron';
import { enrichPlayerData } from './enrichPlayerData';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Schedule the enrichment job to run daily at 3 AM
cron.schedule('0 3 * * *', async () => {
  console.log('Starting scheduled player data enrichment...');
  try {
    await enrichPlayerData();
    console.log('Player data enrichment completed successfully');
  } catch (error) {
    console.error('Error during scheduled enrichment:', error);
  }
});

// Run immediately if called directly
if (require.main === module) {
  console.log('Running initial player data enrichment...');
  enrichPlayerData()
    .then(() => {
      console.log('Initial enrichment completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error during initial enrichment:', error);
      process.exit(1);
    });
} 