import { MySportsFeedsService } from '../services/mysportsfeeds/mysportsfeedsService';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

async function updateTeamStats() {
  try {
    const msfService = MySportsFeedsService.getInstance();
    
    // Update stats for the Tigers (DET)
    const teamStats = await msfService.updateTeamGamesPlayed('DET');
    
    if (teamStats) {
      // TODO: Store teamStats in your database
      console.log(`Successfully updated team stats for ${teamStats.team}:`);
      console.log(`- Games Played: ${teamStats.gamesPlayed}`);
      console.log(`- Wins: ${teamStats.wins}`);
      console.log(`- Losses: ${teamStats.losses}`);
    } else {
      console.error('Failed to update team stats');
    }
  } catch (error) {
    console.error('Error updating team stats:', error);
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