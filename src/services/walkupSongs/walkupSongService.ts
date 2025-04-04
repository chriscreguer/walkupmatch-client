import axios from 'axios';
import mongoose from 'mongoose';
import cron from 'node-cron';
import { PlayerWalkupSong } from '@/lib/walkupSongs/types';
import { SpotifyGenreSummary, SpotifyTopItem } from '@/services/spotify/spotifyService';
import { Position } from '@/lib/mlb/types';

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
  lastUpdated: { type: Date, default: Date.now }
});

// Define TypeScript interface for MongoDB document
interface PlayerDocument extends mongoose.Document {
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
}

// Get existing model or create new one
const Player = mongoose.models.Player || mongoose.model<PlayerDocument>('Player', playerSchema);

interface APIResponse {
  data: {
    id: string;
    name: string;
    mlb_id: string;
    position: string;
    team: {
      name: string;
      id: string;
    };
    songs: Array<{
      id: string;
      title: string;
      artists: string[];
      spotify_image?: string;
    }>;
  };
}

/**
 * Service for matching user music preferences with walkup songs
 */
export class WalkupSongService {
  private static instance: WalkupSongService;
  private readonly API_BASE_URL = 'https://walkupdb.com/api';
  private readonly RATE_LIMIT_DELAY = 1000; // 1 second delay between requests
  private isUpdating = false;
  private readonly MIN_MATCH_SCORE = 0.1;
  private usedSongs: Set<string> = new Set();
  private usedArtists: Map<string, number> = new Map();
  
  private constructor() {
    // Initialize MongoDB connection
    this.initializeMongoDB();
    // Schedule daily updates
    this.scheduleDailyUpdate();
  }

  public static getInstance(): WalkupSongService {
    if (!WalkupSongService.instance) {
      WalkupSongService.instance = new WalkupSongService();
    }
    return WalkupSongService.instance;
  }

  private async initializeMongoDB() {
    try {
      console.log('Attempting to connect to MongoDB...');
      console.log('MongoDB URI:', process.env.MONGO_URI ? 'Set' : 'Not set');
      
      if (!process.env.MONGO_URI) {
        throw new Error('MONGO_URI environment variable is not set');
      }
      
      await mongoose.connect(process.env.MONGO_URI);
      console.log('Connected to MongoDB successfully');
      
      // Verify connection
      const db = mongoose.connection;
      console.log('MongoDB connection state:', db.readyState);
      console.log('MongoDB database name:', db.name);
      
      // Check if we can access the players collection
      if (db.db) {
        const collections = await db.db.listCollections().toArray();
        console.log('Available collections:', collections.map(c => c.name));
      } else {
        console.log('Database object not available');
      }
    } catch (error) {
      console.error('MongoDB connection error:', error);
      if (error instanceof Error) {
        console.error('Error details:', {
          message: error.message,
          stack: error.stack
        });
      }
      throw error;
    }
  }

  private scheduleDailyUpdate() {
    // Run at 3 AM every day
    cron.schedule('0 3 * * *', async () => {
      console.log('Starting scheduled player data update...');
      await this.updatePlayerData();
    });
  }

  private async delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async fetchAllPlayers(): Promise<PlayerDocument[]> {
    const allPlayers: PlayerDocument[] = [];
    let page = 1;
    let hasMore = true;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    const BASE_DELAY = 2000; // 2 seconds base delay

    while (hasMore) {
      try {
        console.log(`Fetching page ${page}...`);
        const response = await axios.get(`${this.API_BASE_URL}/players`, {
          params: { page }
        });

        console.log(`Response status: ${response.status}`);
        
        if (response.data && response.data.data && response.data.data.length > 0) {
          allPlayers.push(...response.data.data);
          console.log(`Added ${response.data.data.length} players. Total: ${allPlayers.length}`);
          
          // Check if there's a next page
          hasMore = response.data.links && response.data.links.next !== null;
          page++;
          
          // Reset retry count on successful request
          retryCount = 0;
          
          // Add delay between successful requests
          await this.delay(this.RATE_LIMIT_DELAY);
        } else {
          console.log('No more players found');
          hasMore = false;
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after']) || 0;
          const delay = Math.max(retryAfter * 1000, BASE_DELAY * Math.pow(2, retryCount));
          
          console.log(`Rate limited. Waiting ${delay/1000} seconds before retry...`);
          await this.delay(delay);
          
          retryCount++;
          if (retryCount >= MAX_RETRIES) {
            console.error('Max retries reached. Stopping fetch.');
            hasMore = false;
          }
        } else {
          console.error(`Error fetching page ${page}:`, error);
          if (axios.isAxiosError(error)) {
            console.error('Error details:', {
              status: error.response?.status,
              statusText: error.response?.statusText,
              data: error.response?.data
            });
          }
          hasMore = false;
        }
      }
    }

    return allPlayers;
  }

  private async fetchPlayerDetails(playerId: string): Promise<APIResponse | null> {
    try {
      const response = await axios.get(`${this.API_BASE_URL}/players/${playerId}`);
      return response.data;
    } catch (error) {
      console.error(`Error fetching details for player ${playerId}:`, error);
      return null;
    }
  }

  private async updatePlayerData() {
    if (this.isUpdating) {
      console.log('Update already in progress');
      return;
    }

    this.isUpdating = true;
    console.log('Starting player data update...');

    try {
      const players = await this.fetchAllPlayers();
      console.log(`Found ${players.length} players to update`);

      for (const player of players) {
        const details = await this.fetchPlayerDetails(player.id);
        if (details) {
          await this.savePlayerToMongoDB(details);
        }
        await this.delay(this.RATE_LIMIT_DELAY);
      }

      console.log('Player data update completed successfully');
    } catch (error) {
      console.error('Error updating player data:', error);
    } finally {
      this.isUpdating = false;
    }
  }

  private async savePlayerToMongoDB(player: APIResponse): Promise<void> {
    try {
      // Validate required fields
      if (!player?.data?.id || !player?.data?.name || !player?.data?.mlb_id) {
        console.log('Invalid player data:', player);
        return;
      }

      const playerData = {
        id: player.data.id,
        mlbId: player.data.mlb_id,
        name: player.data.name,
        position: player.data.position || 'Unknown',
        team: player.data.team?.name || 'Unknown',
        teamId: player.data.team?.id || 'Unknown',
        walkupSong: player.data.songs?.[0] ? {
          id: player.data.songs[0].id,
          songName: player.data.songs[0].title,
          artistName: player.data.songs[0].artists?.join(', ') || 'Unknown',
          albumName: 'Unknown',
          spotifyId: null,
          youtubeId: null,
          genre: [],
          albumArt: player.data.songs[0].spotify_image || null
        } : {
          id: 'no-song',
          songName: 'No walkup song',
          artistName: 'Unknown',
          albumName: 'Unknown',
          spotifyId: null,
          youtubeId: null,
          genre: [],
          albumArt: null
        },
        lastUpdated: new Date()
      };

      console.log('Processing player:', playerData.name);

      // Check if player exists
      const existingPlayer = await Player.findOne({ id: playerData.id });
      console.log('Existing player found:', !!existingPlayer);

      if (existingPlayer) {
        console.log('Updating existing player:', playerData.id);
        const updateResult = await Player.updateOne(
          { id: playerData.id },
          { $set: playerData }
        );
        console.log('Update result:', updateResult);
      } else {
        console.log('Creating new player:', playerData.id);
        const newPlayer = new Player(playerData);
        await newPlayer.save();
        console.log('Created new player:', playerData.id);
      }
    } catch (error) {
      console.error('Error saving player to MongoDB:', error);
      throw error;
    }
  }

  public async getAllPlayers(): Promise<PlayerWalkupSong[]> {
    try {
      const players = await Player.find({});
      return players.map(player => ({
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        team: player.team,
        teamId: player.teamId,
        walkupSong: {
          id: player.walkupSong.id,
          songName: player.walkupSong.songName,
          artistName: player.walkupSong.artistName,
          albumName: player.walkupSong.albumName || '',
          spotifyId: player.walkupSong.spotifyId || '',
          youtubeId: player.walkupSong.youtubeId || '',
          genre: player.walkupSong.genre || [],
          albumArt: player.walkupSong.albumArt || ''
        }
      }));
    } catch (error) {
      console.error('Error fetching players from MongoDB:', error);
      return [];
    }
  }

  public async getPlayerById(playerId: string): Promise<PlayerWalkupSong | null> {
    try {
      const player = await Player.findOne({ id: playerId });
      if (!player || !player.walkupSong) return null;

      return {
        playerId: player.id,
        playerName: player.name,
        position: player.position,
        team: player.team,
        teamId: player.teamId,
        walkupSong: {
          id: player.walkupSong.id,
          songName: player.walkupSong.songName,
          artistName: player.walkupSong.artistName,
          albumName: player.walkupSong.albumName || '',
          spotifyId: player.walkupSong.spotifyId || '',
          youtubeId: player.walkupSong.youtubeId || '',
          genre: player.walkupSong.genre || [],
          albumArt: player.walkupSong.albumArt || ''
        }
      };
    } catch (error) {
      console.error(`Error fetching player ${playerId} from MongoDB:`, error);
      return null;
    }
  }

  public async getPlayersByTeam(teamId: string): Promise<PlayerWalkupSong[]> {
    try {
      const players = await Player.find({ teamId });
      return players.map(player => {
        if (!player.walkupSong) {
          throw new Error(`Player ${player.id} has no walkup song data`);
        }
        return {
          playerId: player.id,
          playerName: player.name,
          position: player.position,
          team: player.team,
          teamId: player.teamId,
          walkupSong: {
            id: player.walkupSong.id,
            songName: player.walkupSong.songName,
            artistName: player.walkupSong.artistName,
            albumName: player.walkupSong.albumName || '',
            spotifyId: player.walkupSong.spotifyId || '',
            youtubeId: player.walkupSong.youtubeId || '',
            genre: player.walkupSong.genre || [],
            albumArt: player.walkupSong.albumArt || ''
          }
        };
      });
    } catch (error) {
      console.error(`Error fetching players for team ${teamId} from MongoDB:`, error);
      return [];
    }
  }

  public async getPlayersByPosition(position: string): Promise<PlayerWalkupSong[]> {
    try {
      const players = await Player.find({ position });
      return players.map(player => {
        if (!player.walkupSong) {
          throw new Error(`Player ${player.id} has no walkup song data`);
        }
        return {
          playerId: player.id,
          playerName: player.name,
          position: player.position,
          team: player.team,
          teamId: player.teamId,
          walkupSong: {
            id: player.walkupSong.id,
            songName: player.walkupSong.songName,
            artistName: player.walkupSong.artistName,
            albumName: player.walkupSong.albumName || '',
            spotifyId: player.walkupSong.spotifyId || '',
            youtubeId: player.walkupSong.youtubeId || '',
            genre: player.walkupSong.genre || [],
            albumArt: player.walkupSong.albumArt || ''
          }
        };
      });
    } catch (error) {
      console.error(`Error fetching players for position ${position} from MongoDB:`, error);
      return [];
    }
  }

  /**
   * Find the best player for each position based on multiple matching criteria
   */
  async findTeamByPreferences(
    userGenres: SpotifyGenreSummary[],
    userTopTracks: { short_term: SpotifyTopItem[], medium_term: SpotifyTopItem[], long_term: SpotifyTopItem[] },
    userTopArtists: { short_term: SpotifyTopItem[], medium_term: SpotifyTopItem[], long_term: SpotifyTopItem[] },
    userSavedTracks: SpotifyTopItem[],
    positions: Position[]
  ): Promise<PlayerWalkupSong[]> {
    const allPlayerSongs = await this.getAllPlayers(); // Get all players from MongoDB
    
    // Filter out players without valid walkup songs
    const validPlayers = allPlayerSongs.filter(player => 
      player.walkupSong && 
      player.walkupSong.songName && 
      player.walkupSong.artistName &&
      player.walkupSong.songName !== 'No walkup song'
    );

    console.log(`Found ${validPlayers.length} players with valid walkup songs out of ${allPlayerSongs.length} total players`);

    const team: PlayerWalkupSong[] = [];
    this.usedSongs.clear(); // Reset used songs for new team generation
    this.usedArtists.clear(); // Reset used artists for new team generation
    
    // Log user's top genres
    console.log('User top genres:', userGenres.slice(0, 10).map(g => `${g.name} (${g.weight.toFixed(2)})`));
    
    // Extract top genres from user preferences with their weights
    const userTopGenres = userGenres.slice(0, 10).map(g => ({
      name: g.name,
      weight: g.weight
    }));
    
    // Normalize user's music data for matching
    const userTracks = {
      short_term: this.normalizeTracks(userTopTracks.short_term),
      medium_term: this.normalizeTracks(userTopTracks.medium_term),
      long_term: this.normalizeTracks(userTopTracks.long_term)
    };
    const userArtists = {
      short_term: this.normalizeArtists(userTopArtists.short_term),
      medium_term: this.normalizeArtists(userTopArtists.medium_term),
      long_term: this.normalizeArtists(userTopArtists.long_term)
    };
    const userSaved = this.normalizeTracks(userSavedTracks);
    
    // Calculate match scores for all valid players
    const playersWithScores = validPlayers.map(player => {
      const songMatch = this.findSongMatch(player.walkupSong, userTracks, userSaved);
      const artistMatch = this.findArtistMatch(player.walkupSong, userArtists);
      const genreMatch = this.calculateGenreMatchScore(userTopGenres, player.walkupSong.genre);
      
      // Combine scores with weights
      let matchScore = 0;
      let matchReason = genreMatch.matchReason;
      let rankInfo = '';

      if (songMatch.score === 0.9) {
        matchScore = 1.5;
        matchReason = 'Liked song';
      } else if (songMatch.score > 0) {
        if (songMatch.score >= 1.0) {
          matchScore = 2.0 + (songMatch.rankBonus || 0);
          matchReason = 'Top song';
          if (songMatch.rank && songMatch.timeFrame) {
            rankInfo = `#${songMatch.rank} ${songMatch.timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(songMatch.timeFrame)}`}`;
          }
        } else {
          matchScore = 1.0;
          matchReason = 'Partial song match';
        }
      } else if (artistMatch.score > 0) {
        if (artistMatch.score >= 0.8) {
          matchScore = 1.2 + (artistMatch.score - 0.8);
          matchReason = 'Top artist';
          if (artistMatch.rank && artistMatch.timeFrame) {
            rankInfo = `#${artistMatch.rank} ${artistMatch.timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(artistMatch.timeFrame)}`}`;
          }
        } else {
          matchScore = 0.8;
          matchReason = 'Partial artist match';
        }
      } else {
        matchScore = genreMatch.matchScore * 0.5;
      }

      // Apply artist diversity penalty
      const artistCount = this.usedArtists.get(player.walkupSong.artistName) || 0;
      if (artistCount > 0) {
        matchScore *= (1 - (artistCount * 0.2));
      }
      
      return { player, matchScore, matchReason, rankInfo };
    });
    
    // Sort all players by match score
    const sortedPlayers = playersWithScores
      .sort((a, b) => b.matchScore - a.matchScore)
      .filter(p => p.matchScore >= this.MIN_MATCH_SCORE);
    
    console.log(`Found ${sortedPlayers.length} players with match scores above minimum threshold`);
    
    // Take the top players needed for the team
    const selectedPlayers = sortedPlayers.slice(0, positions.length);
    
    // Assign positions to selected players
    selectedPlayers.forEach((playerWithScore, index) => {
      const position = positions[index];
      this.usedSongs.add(playerWithScore.player.walkupSong.songName);
      this.incrementArtistCount(playerWithScore.player.walkupSong.artistName);
      
      team.push({
        ...playerWithScore.player,
        position,
        matchReason: playerWithScore.matchReason,
        rankInfo: playerWithScore.rankInfo,
        matchScore: playerWithScore.matchScore
      });
    });
    
    return team;
  }
  
  /**
   * Normalize tracks for matching
   */
  private normalizeTracks(tracks: SpotifyTopItem[]): Array<{ name: string; artist: string }> {
    return tracks.map(track => ({
      name: track.name.toLowerCase(),
      artist: track.artists?.[0]?.name.toLowerCase() || ''
    }));
  }
  
  /**
   * Normalize artists for matching
   */
  private normalizeArtists(artists: SpotifyTopItem[]): string[] {
    return artists.map(artist => artist.name.toLowerCase());
  }
  
  /**
   * Find direct song matches
   */
  private findSongMatch(
    walkupSong: { songName: string | null | undefined; artistName: string | null | undefined },
    userTracks: { short_term: Array<{ name: string; artist: string }>, medium_term: Array<{ name: string; artist: string }>, long_term: Array<{ name: string; artist: string }> },
    userSaved: Array<{ name: string; artist: string }>
  ): { score: number; rank?: number; rankBonus?: number; timeFrame?: 'short_term' | 'medium_term' | 'long_term' } {
    // Skip if song name or artist name is missing
    if (!walkupSong.songName || !walkupSong.artistName) {
      return { score: 0 };
    }

    const normalizedSong = {
      name: walkupSong.songName.toLowerCase(),
      artist: walkupSong.artistName.toLowerCase()
    };
    
    // Check for exact matches in top tracks across all time frames
    // Order of time frames matters for priority
    const timeFrames: Array<'short_term' | 'medium_term' | 'long_term'> = ['medium_term', 'long_term', 'short_term'];
    for (const timeFrame of timeFrames) {
      const tracks = userTracks[timeFrame];
      const trackIndex = tracks.findIndex(track => 
        track.name === normalizedSong.name && track.artist === normalizedSong.artist
      );
      
      if (trackIndex !== -1) {
        const rank = trackIndex + 1;
        // Add a small bonus for medium term (0.05), then long term (0.03)
        const timeFrameBonus = timeFrame === 'medium_term' ? 0.05 : timeFrame === 'long_term' ? 0.03 : 0;
        // Increased rank bonus for higher-ranked songs (top 10 get 0.5, top 25 get 0.3, top 50 get 0.1)
        const rankBonus = rank <= 10 ? 0.5 : rank <= 25 ? 0.3 : rank <= 50 ? 0.1 : 0;
        return { 
          score: 1.0 + timeFrameBonus, // Base score of 1.0 plus time frame bonus
          rank, 
          rankBonus,
          timeFrame
        };
      }
    }
    
    // Check for saved songs with higher priority
    const savedMatch = userSaved.some(track => 
      track.name === normalizedSong.name && track.artist === normalizedSong.artist
    );
    
    if (savedMatch) return { score: 0.9 }; // Increased from 0.8 to be above artist matches
    
    // Check for partial matches (same song, different artist)
    const partialMatch = Object.values(userTracks).some(tracks => 
      tracks.some(track => track.name === normalizedSong.name)
    );
    
    if (partialMatch) return { score: 0.6 };
    
    return { score: 0 };
  }
  
  /**
   * Find artist matches
   */
  private findArtistMatch(
    walkupSong: { artistName: string | null | undefined },
    userArtists: { short_term: string[], medium_term: string[], long_term: string[] }
  ): { score: number; rank?: number; timeFrame?: 'short_term' | 'medium_term' | 'long_term' } {
    // Skip if artist name is missing
    if (!walkupSong.artistName) {
      return { score: 0 };
    }

    const normalizedArtist = walkupSong.artistName.toLowerCase();
    
    // Check for exact artist match across all time frames
    // Order of time frames matters for priority
    const timeFrames: Array<'short_term' | 'medium_term' | 'long_term'> = ['medium_term', 'long_term', 'short_term'];
    for (const timeFrame of timeFrames) {
      const artists = userArtists[timeFrame];
      const artistIndex = artists.findIndex(artist => artist === normalizedArtist);
      if (artistIndex !== -1) {
        const rank = artistIndex + 1;
        // Only apply time frame bonus for medium and long term
        const timeFrameBonus = timeFrame === 'medium_term' ? 0.05 : timeFrame === 'long_term' ? 0.03 : 0;
        
        // Increased rank bonus for higher-ranked artists (top 10 get 0.4, top 25 get 0.2, top 50 get 0.1)
        const rankBonus = rank <= 10 ? 0.4 : rank <= 25 ? 0.2 : rank <= 50 ? 0.1 : 0;
        
        // Reduce score for artists past #25 in medium and long term
        const rankPenalty = (timeFrame === 'medium_term' || timeFrame === 'long_term') && rank > 25 
          ? (rank - 25) * 0.01 
          : 0;
        
        return { 
          score: 0.8 + timeFrameBonus + rankBonus - rankPenalty, // Base score of 0.8 plus time frame and rank bonuses minus rank penalty
          rank,
          timeFrame
        };
      }
    }
    
    // Check for partial artist name match
    const partialMatch = Object.values(userArtists).some(artists => 
      artists.some(artist => 
        artist.includes(normalizedArtist) || normalizedArtist.includes(artist)
      )
    );
    
    if (partialMatch) return { score: 0.5 };
    
    return { score: 0 };
  }
  
  /**
   * Calculate match score between user genres and player song genres
   */
  private calculateGenreMatchScore(
    userGenres: Array<{ name: string; weight: number }>, 
    playerGenres: string[]
  ): { matchScore: number; matchReason: string; matchedGenres: string[] } {
    // Normalize all genres to lowercase for comparison
    const normalizedPlayerGenres = playerGenres.map(g => g.toLowerCase());
    const normalizedUserGenres = userGenres.map(g => ({
      name: g.name.toLowerCase(),
      weight: g.weight
    }));
    
    // Find matching genres and their weights
    const matches = normalizedUserGenres
      .filter(userGenre => 
        normalizedPlayerGenres.some(playerGenre => 
          this.areGenresSimilar(playerGenre, userGenre.name)
        )
      )
      .map(match => ({
        name: match.name,
        weight: match.weight
      }));
    
    // Calculate weighted match score
    const totalWeight = userGenres.reduce((sum, g) => sum + g.weight, 0);
    const matchScore = matches.reduce((sum, m) => sum + m.weight, 0) / totalWeight;
    
    // Generate match reason based on match quality and matched genres
    let matchReason = '';
    const matchedGenreNames = matches.map(m => m.name);
    
    if (matchScore >= 0.8) {
      matchReason = `Strong match with your top genres: ${matchedGenreNames.slice(0, 2).join(', ')}`;
    } else if (matchScore >= 0.5) {
      matchReason = `Matches your genre preferences: ${matchedGenreNames[0]}`;
    } else if (matchScore >= 0.3) {
      matchReason = `Partial match with your music taste: ${matchedGenreNames[0]}`;
    } else if (matchScore >= 0.1) {
      matchReason = `Light match with your music taste: ${matchedGenreNames[0]}`;
    } else {
      matchReason = 'Based on your music taste';
    }
    
    return { matchScore, matchReason, matchedGenres: matchedGenreNames };
  }
  
  /**
   * Check if two genres are similar enough to be considered a match
   */
  private areGenresSimilar(genre1: string, genre2: string): boolean {
    // Direct match
    if (genre1 === genre2) return true;
    
    // Check if one genre contains the other
    if (genre1.includes(genre2) || genre2.includes(genre1)) return true;
    
    // Handle common variations
    const variations = {
      'hip hop': ['rap', 'trap', 'drill', 'hiphop'],
      'rock': ['metal', 'punk', 'grunge', 'hard rock', 'classic rock', 'alternative rock'],
      'pop': ['dance', 'electronic', 'edm', 'house', 'dance pop'],
      'r&b': ['soul', 'funk', 'rnb', 'urban contemporary'],
      'country': ['folk', 'bluegrass', 'americana'],
      'jazz': ['swing', 'blues', 'smooth jazz'],
      'classical': ['orchestral', 'symphony', 'chamber music'],
      'reggae': ['reggaeton', 'dancehall'],
      'latin': ['salsa', 'merengue', 'bachata', 'cumbia'],
      'indie': ['indie pop', 'indie rock', 'alternative']
    };
    
    for (const [mainGenre, relatedGenres] of Object.entries(variations)) {
      if (
        (genre1 === mainGenre && relatedGenres.includes(genre2)) ||
        (genre2 === mainGenre && relatedGenres.includes(genre1))
      ) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Increment the count of used songs for an artist
   */
  private incrementArtistCount(artistName: string): void {
    const currentCount = this.usedArtists.get(artistName) || 0;
    this.usedArtists.set(artistName, currentCount + 1);
  }

  /**
   * Get the ordinal suffix for a number (1st, 2nd, 3rd, etc.)
   */
  private getOrdinalSuffix(n: number): string {
    const j = n % 10;
    const k = n % 100;
    if (j === 1 && k !== 11) return 'st';
    if (j === 2 && k !== 12) return 'nd';
    if (j === 3 && k !== 13) return 'rd';
    return 'th';
  }

  /**
   * Get time frame label
   */
  private getTimeFrameLabel(timeFrame: 'short_term' | 'medium_term' | 'long_term'): string {
    switch (timeFrame) {
      case 'short_term': return 'past 4 weeks';
      case 'medium_term': return 'past 6 months';
      case 'long_term': return 'all time';
      default: return '';
    }
  }
}