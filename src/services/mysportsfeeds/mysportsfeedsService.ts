import axios from 'axios';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

interface MySportsFeedsPlayer {
  player: {
    id: string;
    firstName: string;
    lastName: string;
    primaryPosition: string;
    currentTeam: {
      id: string;
      abbreviation: string;
    };
  };
  stats: {
    batting: {
      battingAvg: number;
      batterOnBasePct: number;
      batterSluggingPct: number;
      plateAppearances: number;
    };
    pitching: {
      earnedRunAvg: number;
      inningsPitched: number;
    };
  };
}

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
  stats?: {
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

interface PlayerMaps {
  playersByName: Record<string, MySportsFeedsPlayer[]>;
  playersByFirstName: Record<string, MySportsFeedsPlayer[]>;
  playersByLastName: Record<string, MySportsFeedsPlayer[]>;
  allPlayers: MySportsFeedsPlayer[];
}

interface NameConflict {
  playerName: string;
  matches: MySportsFeedsPlayer[];
}

interface TeamStats {
  team: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  lastUpdated: Date;
}

export class MySportsFeedsService {
  private static instance: MySportsFeedsService;
  private readonly API_BASE_URL = 'https://api.mysportsfeeds.com/v2.1/pull/mlb';
  private readonly API_KEY: string;
  private readonly API_PASSWORD = 'MYSPORTSFEEDS';
  private readonly SEASON = 'current';
  private lastRequestTime = 0;
  private readonly RATE_LIMIT_DELAY = 5500; // 5.5 seconds between requests
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;
  private nameConflicts: NameConflict[] = [];

  private constructor() {
    const apiKey = process.env.MYSPORTSFEEDS_API_KEY;
    if (!apiKey) {
      throw new Error('MYSPORTSFEEDS_API_KEY is not set in environment variables');
    }
    this.API_KEY = apiKey;
  }

  public static getInstance(): MySportsFeedsService {
    if (!MySportsFeedsService.instance) {
      MySportsFeedsService.instance = new MySportsFeedsService();
    }
    return MySportsFeedsService.instance;
  }

  private getAuthHeader(): string {
    const credentials = `${this.API_KEY}:${this.API_PASSWORD}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
      const waitTime = this.RATE_LIMIT_DELAY - timeSinceLastRequest;
      console.log(`Waiting ${waitTime}ms before next request...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastRequestTime = Date.now();
  }

  public async fetchAllPlayerData(): Promise<PlayerMaps> {
    try {
      await this.waitForRateLimit();
      
      console.log("Fetching all player data from MySportsFeeds API...");
      const response = await axios.get(`${this.API_BASE_URL}/${this.SEASON}/player_stats_totals.json`, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/json'
        },
        params: {
          force: false
        }
      });
  
      console.log(`API Response status: ${response.status}`);
      
      const playerStats = response.data.playerStatsTotals || [];
      console.log(`Retrieved data for ${playerStats.length} players from API`);
      
      // Create maps for different lookup strategies
      const playersByName: Record<string, MySportsFeedsPlayer[]> = {};
      const playersByFirstName: Record<string, MySportsFeedsPlayer[]> = {};
      const playersByLastName: Record<string, MySportsFeedsPlayer[]> = {};
      
      playerStats.forEach((playerData: MySportsFeedsPlayer) => {
        if (playerData.player) {
          const firstName = playerData.player.firstName?.toLowerCase().trim() || '';
          const lastName = playerData.player.lastName?.toLowerCase().trim() || '';
          const fullName = `${firstName} ${lastName}`.trim();
          
          // Store by full name
          if (!playersByName[fullName]) {
            playersByName[fullName] = [];
          }
          playersByName[fullName].push(playerData);
          
          // Store by first name
          if (!playersByFirstName[firstName]) {
            playersByFirstName[firstName] = [];
          }
          playersByFirstName[firstName].push(playerData);
          
          // Store by last name
          if (!playersByLastName[lastName]) {
            playersByLastName[lastName] = [];
          }
          playersByLastName[lastName].push(playerData);
        }
      });
      
      return {
        playersByName,
        playersByFirstName,
        playersByLastName,
        allPlayers: playerStats
      };
    } catch (error) {
      console.error("Error fetching all player data:", error);
      if (axios.isAxiosError(error)) {
        console.error("API Error details:", {
          status: error.response?.status,
          data: error.response?.data
        });
      }
      return {
        playersByName: {},
        playersByFirstName: {},
        playersByLastName: {},
        allPlayers: []
      };
    }
  }
  
  public findBestPlayerMatch(player: PlayerDocument, playerMaps: PlayerMaps): MySportsFeedsPlayer | null {
    // Normalize the player name from our database
    const firstName = player.name.split(' ')[0]?.toLowerCase().trim() || '';
    const lastName = this.getLastName(player.name)?.toLowerCase().trim() || '';
    const fullName = `${firstName} ${lastName}`.trim();
    
    // Try exact full name match
    const exactMatches = playerMaps.playersByName[fullName] || [];
    
    if (exactMatches.length === 1) {
      // Single exact match found - perfect!
      console.log(`Found exact name match for ${player.name}`);
      return exactMatches[0];
    } 
    else if (exactMatches.length > 1) {
      // Multiple players with same name - try to disambiguate by position and team
      console.log(`Found ${exactMatches.length} players with name ${fullName}, attempting to disambiguate`);
      
      let matches = exactMatches;
      
      if (player.position && player.position !== 'Unknown') {
        matches = matches.filter(p => 
          p.player.primaryPosition?.toLowerCase() === player.position.toLowerCase()
        );
      }
      
      if (player.team && player.team !== 'Unknown' && matches.length > 1) {
        matches = matches.filter(p => 
          p.player.currentTeam.abbreviation?.toLowerCase() === player.team.toLowerCase()
        );
      }
      
      if (matches.length === 1) {
        console.log(`Successfully disambiguated ${player.name} using position/team data`);
        return matches[0];
      } else if (matches.length > 1) {
        // If we still have multiple matches after trying to disambiguate, log the conflict
        this.nameConflicts.push({
          playerName: player.name,
          matches: matches
        });
        console.log(`WARNING: Unable to disambiguate ${player.name} - skipping enrichment`);
        return null;
      }
    }
    
    // No match found
    console.log(`No exact match found for ${player.name}`);
    return null;
  }
  
  private getLastName(fullName: string): string {
    const parts = fullName.split(' ');
    return parts.length > 1 ? parts.slice(1).join(' ') : '';
  }
  
  public getConflicts(): NameConflict[] {
    return this.nameConflicts;
  }
  
  public async enrichPlayerData(player: PlayerDocument, playerMaps?: PlayerMaps): Promise<PlayerDocument> {
    try {
      if (!playerMaps) {
        console.log('No player maps provided, skipping enrichment');
        return player;
      }

      const matchedPlayer = this.findBestPlayerMatch(player, playerMaps);
      if (matchedPlayer) {
        // Check if player has any stats for the current season (minimum 1 PA or 1 IP)
        const hasBattingStats = matchedPlayer.stats?.batting?.plateAppearances >= 1;
        const hasPitchingStats = matchedPlayer.stats?.pitching?.inningsPitched >= 1;
        const hasCurrentSeasonStats = hasBattingStats || hasPitchingStats;

        // If no current season stats, return player with zeroed stats
        if (!hasCurrentSeasonStats) {
          console.log(`No current season stats found for ${player.name}, zeroing stats`);
          return {
            ...player,
            position: matchedPlayer.player.primaryPosition,
            team: matchedPlayer.player.currentTeam.abbreviation,
            teamId: matchedPlayer.player.currentTeam.id,
            stats: {
              batting: {
                battingAvg: 0,
                onBasePercentage: 0,
                sluggingPercentage: 0,
                plateAppearances: 0
              },
              pitching: {
                earnedRunAvg: 0,
                inningsPitched: 0
              }
            }
          };
        }

        // Player has current season stats, use them
        return {
          ...player,
          position: matchedPlayer.player.primaryPosition,
          team: matchedPlayer.player.currentTeam.abbreviation,
          teamId: matchedPlayer.player.currentTeam.id,
          stats: {
            batting: {
              battingAvg: matchedPlayer.stats.batting.battingAvg || 0,
              onBasePercentage: matchedPlayer.stats.batting.batterOnBasePct || 0,
              sluggingPercentage: matchedPlayer.stats.batting.batterSluggingPct || 0,
              plateAppearances: matchedPlayer.stats.batting.plateAppearances || 0
            },
            pitching: {
              earnedRunAvg: matchedPlayer.stats.pitching.earnedRunAvg || 0,
              inningsPitched: matchedPlayer.stats.pitching.inningsPitched || 0
            }
          }
        };
      }

      // No match found - zero out stats and keep existing position/team
      console.log(`No match found for ${player.name} in player maps, zeroing stats`);
      return {
        ...player,
        stats: {
          batting: {
            battingAvg: 0,
            onBasePercentage: 0,
            sluggingPercentage: 0,
            plateAppearances: 0
          },
          pitching: {
            earnedRunAvg: 0,
            inningsPitched: 0
          }
        }
      };
    } catch (error) {
      console.error(`Error enriching player data for ${player.name}:`, error);
      // On error, zero out stats to be safe
      return {
        ...player,
        stats: {
          batting: {
            battingAvg: 0,
            onBasePercentage: 0,
            sluggingPercentage: 0,
            plateAppearances: 0
          },
          pitching: {
            earnedRunAvg: 0,
            inningsPitched: 0
          }
        }
      };
    }
  }

  public async updateTeamGamesPlayed(teamAbbr: string): Promise<TeamStats | null> {
    try {
      await this.waitForRateLimit();
      
      console.log(`Fetching team stats for ${teamAbbr} from MySportsFeeds API...`);
      const response = await axios.get(`${this.API_BASE_URL}/${this.SEASON}/standings.json`, {
        headers: {
          'Authorization': this.getAuthHeader(),
          'Accept': 'application/json'
        },
        params: {
          team: teamAbbr
        }
      });

      const teamData = response.data.standings?.entries?.[0];
      if (!teamData) {
        console.error(`No team data found for ${teamAbbr}`);
        return null;
      }

      const stats = teamData.stats;
      const gamesPlayed = (stats.wins || 0) + (stats.losses || 0);
      
      const teamStats: TeamStats = {
        team: teamAbbr,
        gamesPlayed,
        wins: stats.wins || 0,
        losses: stats.losses || 0,
        lastUpdated: new Date()
      };

      console.log(`Retrieved team stats for ${teamAbbr}: ${gamesPlayed} games played`);
      return teamStats;
    } catch (error) {
      console.error(`Error updating team games played for ${teamAbbr}:`, error);
      if (axios.isAxiosError(error)) {
        console.error("API Error details:", {
          status: error.response?.status,
          data: error.response?.data
        });
      }
      return null;
    }
  }
}

const msfService = MySportsFeedsService.getInstance();
const conflicts = msfService.getConflicts();

console.log('Name conflicts that need manual resolution:');
conflicts.forEach(conflict => {
  console.log(`\nPlayer: ${conflict.playerName}`);
  console.log('Possible matches:');
  conflict.matches.forEach(match => {
    console.log(`- ${match.player.firstName} ${match.player.lastName} (${match.player.primaryPosition}, ${match.player.currentTeam.abbreviation})`);
  });
});