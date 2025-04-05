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
  lastUpdated: { type: Date, default: Date.now },
  stats: {
    batting: {
      battingAvg: Number,
      onBasePercentage: Number,
      sluggingPercentage: Number,
      plateAppearances: Number
    },
    pitching: {
      earnedRunAvg: Number,
      inningsPitched: Number
    }
  }
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
  stats: {
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

// Matching data types
interface NormalizedTrack {
  name: string;
  artist: string;
  spotifyId?: string;
  rank?: number;
  timeFrame?: TimeFrame;
}

interface NormalizedArtist {
  name: string;
  id?: string;
  rank?: number;
  timeFrame?: TimeFrame;
}

interface MatchResult {
  score: number;
  reason: string;
  details?: string;
  rank?: number;
  timeFrame?: TimeFrame;
}

interface PlayerWithScore {
  player: PlayerWalkupSong;
  matchScore: number;
  originalMatchScore: number;
  matchReason: string;
  rankInfo: string;
  matchingSongs: Array<{
    songName: string;
    artistName: string;
    matchScore: number;
    matchReason: string;
    rankInfo: string;
    albumArt: string;
    previewUrl?: string | null;
  }>;
}

type TimeFrame = 'short_term' | 'medium_term' | 'long_term';

// We now wrap each team assignment with the candidate and its assigned slot.
interface TeamAssignment {
  candidate: PlayerWithScore;
  assignedPosition: Position;
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
 * Service for matching user music preferences with walkup songs.
 * This version uses a two‑pass greedy approach:
 *  • First pass: For each position, select the highest‑scoring eligible candidate while ensuring
 *    uniqueness of both players and songs. The assigned slot is stored separately.
 *  • Second pass: For positions with duplicate artists or songs, attempt to swap the lower‑ranked occurrence
 *    with an alternative candidate. When evaluating alternatives, we compute an effective score (applying
 *    a penalty based on how many times the candidate's artist already appears) and then assign the candidate
 *    to the slot (overriding their DB position).
 */
export class WalkupSongService {
  private static instance: WalkupSongService;
  private readonly API_BASE_URL = 'https://walkupdb.com/api';
  private readonly RATE_LIMIT_DELAY = 1000;
  private isUpdating = false;
  private readonly MIN_MATCH_SCORE = 0.1;
  private usedSongs: Set<string> = new Set();
  private genreSimilarityCache: Map<string, boolean> = new Map();

  // Compatibility matrices; DH handled separately
  private readonly COMPATIBLE_POSITIONS: Record<string, string[]> = {
    'C': [],
    '1B': [],
    '2B': ['SS'],
    '3B': [],
    'SS': ['2B'],
    'OF': [],
    'DH': [],
    'P': []
  };
  private readonly SIMILAR_POSITIONS: Record<string, string[]> = {
    'C': [],
    '1B': [],
    '2B': ['3B'],
    '3B': ['SS, 2B'],
    'SS': ['3B'],
    'OF': [],
    'DH': ['1B', 'OF'],
    'P': []
  };
  // For DH, fallback positions if no direct match
  private readonly FALLBACK_POSITIONS: Record<string, string[]> = {
    'DH': ['2B', '3B', 'C', 'SS']
  };

  // Position weight mapping
  private readonly POSITION_WEIGHTS: Record<string, number> = {
    'EXACT': 1.0,
    'SIMILAR': 0.8,
    'COMPATIBLE': 0.6,
    'FALLBACK': 0.4
  };

  // Score adjustment weights - UPDATED AS REQUESTED
  private readonly SCORE_WEIGHTS = {
    TIME_FRAME: {
      'long_term': 0.05,
      'medium_term': 0.03,
      'short_term': 0.01
    },
    RANK: {
      TOP_10: 0.2,
      TOP_25: 0.1,
      TOP_50: 0
    },
    MATCH_TYPE: {
      LIKED_SONG: 1.2, // Changed from 1.5 to 1.2
      TOP_SONG: 1.5,   // Changed from 1.0 to 1.5
      TOP_ARTIST: 0.8,
      PARTIAL_SONG: 0.2, // Changed from 0.6 to 0.2
      PARTIAL_ARTIST: 0.2, // Changed from 0.5 to 0.2
      GENRE: 0.4
    },
    // Penalty for duplicate artist occurrences:
    ARTIST_DIVERSITY_PENALTY: {
      FIRST: 0.0,
      SECOND: 0.4,
      THIRD: 0.6,
      FOURTH: 0.7,
      FIFTH_PLUS: 0.8
    },
    MULTIPLE_MATCHES_BONUS: 0.1,
    GENRE_VARIETY_BONUS: 0.15,
    // Small bonus for genre matches where user has liked songs by the artist
    GENRE_ARTIST_LIKED_BONUS: 0.05
  };

  private constructor() {
    this.initializeMongoDB();
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
      const db = mongoose.connection;
      console.log('MongoDB connection state:', db.readyState);
      console.log('MongoDB database name:', db.name);
      if (db.db) {
        const collections = await db.db.listCollections().toArray();
        console.log('Available collections:', collections.map(c => c.name));
      }
    } catch (error) {
      console.error('MongoDB connection error:', error);
      throw error;
    }
  }

  private scheduleDailyUpdate() {
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
    const BASE_DELAY = 2000;
    while (hasMore) {
      try {
        console.log(`Fetching page ${page}...`);
        const response = await axios.get(`${this.API_BASE_URL}/players`, { params: { page } });
        console.log(`Response status: ${response.status}`);
        if (response.data && response.data.data && response.data.data.length > 0) {
          allPlayers.push(...response.data.data);
          console.log(`Added ${response.data.data.length} players. Total: ${allPlayers.length}`);
          hasMore = response.data.links && response.data.links.next !== null;
          page++;
          retryCount = 0;
          await this.delay(this.RATE_LIMIT_DELAY);
        } else {
          console.log('No more players found');
          hasMore = false;
        }
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 429) {
          const retryAfter = parseInt(error.response.headers['retry-after']) || 0;
          const delayTime = Math.max(retryAfter * 1000, BASE_DELAY * Math.pow(2, retryCount));
          console.log(`Rate limited. Waiting ${delayTime / 1000} seconds before retry...`);
          await this.delay(delayTime);
          retryCount++;
          if (retryCount >= MAX_RETRIES) {
            console.error('Max retries reached. Stopping fetch.');
            hasMore = false;
          }
        } else {
          console.error(`Error fetching page ${page}:`, error);
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
        walkupSong: player.data.songs?.[0]
          ? {
              id: player.data.songs[0].id,
              songName: player.data.songs[0].title,
              artistName: player.data.songs[0].artists?.join(', ') || 'Unknown',
              albumName: 'Unknown',
              spotifyId: null,
              youtubeId: null,
              genre: [],
              albumArt: player.data.songs[0].spotify_image || null
            }
          : {
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
      const existingPlayer = await Player.findOne({ id: playerData.id });
      if (existingPlayer) {
        console.log('Updating existing player:', playerData.id);
        await Player.updateOne({ id: playerData.id }, { $set: playerData });
      } else {
        console.log('Creating new player:', playerData.id);
        const newPlayer = new Player(playerData);
        await newPlayer.save();
      }
    } catch (error) {
      console.error('Error saving player to MongoDB:', error);
      throw error;
    }
  }

  public async getAllPlayers(): Promise<PlayerWalkupSong[]> {
    try {
      const players = await Player.find({});
      console.log('Raw player data from MongoDB:', players.map(p => ({ name: p.name, stats: p.stats })));
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
        },
        stats: {
          batting: {
            battingAvg: player.stats?.batting?.battingAvg || 0,
            onBasePercentage: player.stats?.batting?.onBasePercentage || 0,
            sluggingPercentage: player.stats?.batting?.sluggingPercentage || 0,
            plateAppearances: player.stats?.batting?.plateAppearances || 0
          },
          pitching: {
            earnedRunAvg: player.stats?.pitching?.earnedRunAvg || 0,
            inningsPitched: player.stats?.pitching?.inningsPitched || 0
          }
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
   * Two-pass greedy team selection:
   *  1. First pass: For each position, select the highest‑scoring eligible candidate,
   *     ensuring that the same candidate and song are not reused.
   *     The candidate is wrapped with an assignedPosition field (the team slot).
   *  2. Second pass: For positions with duplicate artists or songs, attempt to swap
   *     the lower‑scored occurrence with an alternative candidate. When swapping,
   *     compute an effective score for both the current candidate and the alternative
   *     (applying a penalty based on duplicate rank) and update the assignedPosition.
   */
  public async findTeamByPreferences(
    userGenres: SpotifyGenreSummary[],
    userTopTracks: { short_term: SpotifyTopItem[]; medium_term: SpotifyTopItem[]; long_term: SpotifyTopItem[] },
    userTopArtists: { short_term: SpotifyTopItem[]; medium_term: SpotifyTopItem[]; long_term: SpotifyTopItem[] },
    userSavedTracks: SpotifyTopItem[],
    positions: Position[]
  ): Promise<PlayerWalkupSong[]> {
    // Reset caches
    this.usedSongs.clear();
    this.genreSimilarityCache.clear();
    console.log('Starting team preference matching...');

    // Get and filter player data
    const allPlayerSongs = await this.getAllPlayers();
    console.log('Total players before filtering:', allPlayerSongs.length);
    
    const validPlayers = allPlayerSongs.filter(player => {
      // Basic walkup song validation
      const hasValidWalkupSong = player.walkupSong &&
        player.walkupSong.songName &&
        player.walkupSong.artistName &&
        player.walkupSong.songName !== 'No walkup song';
      
      if (!hasValidWalkupSong) {
        return false;
      }

      // Stats validation
      if (player.position !== 'P') {
        // For non-pitchers, check PA
        const pa = player.stats?.batting?.plateAppearances ?? 0;
        return pa >= 5;
      } else {
        // For pitchers, check IP
        const ip = player.stats?.pitching?.inningsPitched ?? 0;
        return ip >= 3;
      }
    });
    
    console.log('Players after filtering:', validPlayers.length);
    console.log('Sample of filtered players:', validPlayers.slice(0, 5).map(p => ({
      name: p.playerName,
      position: p.position,
      pa: p.stats?.batting?.plateAppearances,
      ip: p.stats?.pitching?.inningsPitched
    })));

    // Normalize user preferences
    const userTopGenres = userGenres.slice(0, 10).map(g => ({
      name: g.name.toLowerCase(),
      weight: g.weight
    }));
    const normalizedUserTracks: Record<TimeFrame, NormalizedTrack[]> = { long_term: [], medium_term: [], short_term: [] };
    for (const timeFrame of ['long_term', 'medium_term', 'short_term'] as TimeFrame[]) {
      normalizedUserTracks[timeFrame] = userTopTracks[timeFrame].map((track, index) => ({
        name: (track.name || '').toLowerCase(),
        artist: (track.artists?.[0]?.name || '').toLowerCase(),
        spotifyId: track.id,
        rank: index + 1,
        timeFrame
      }));
    }
    const normalizedUserArtists: Record<TimeFrame, NormalizedArtist[]> = { long_term: [], medium_term: [], short_term: [] };
    for (const timeFrame of ['long_term', 'medium_term', 'short_term'] as TimeFrame[]) {
      normalizedUserArtists[timeFrame] = userTopArtists[timeFrame].map((artist, index) => ({
        name: (artist.name || '').toLowerCase(),
        id: artist.id,
        rank: index + 1,
        timeFrame
      }));
    }
    const normalizedSavedTracks: NormalizedTrack[] = userSavedTracks.map(track => ({
      name: (track.name || '').toLowerCase(),
      artist: (track.artists?.[0]?.name || '').toLowerCase(),
      spotifyId: track.id
    }));
    const savedTracksMap = new Map<string, boolean>();
    normalizedSavedTracks.forEach(track => {
      if (track.name && track.artist) {
        savedTracksMap.set(`${track.name}|${track.artist}`, true);
      }
      if (track.spotifyId) {
        savedTracksMap.set(track.spotifyId, true);
      }
    });

    // Create a map of artists that the user has liked songs from
    const artistsWithLikedSongs = new Set<string>();
    normalizedSavedTracks.forEach(track => {
      if (track.artist) {
        artistsWithLikedSongs.add(track.artist);
      }
    });

    // Calculate match scores for valid players
    const playersWithScores: PlayerWithScore[] = validPlayers.map(player => {
      if (!player.walkupSong || !player.walkupSong.songName || !player.walkupSong.artistName) {
        return {
          player,
          matchScore: 0,
          originalMatchScore: 0,
          matchReason: 'Invalid walkup song data',
          rankInfo: '',
          matchingSongs: []
        };
      }
      const normalizedPlayerSong = {
        name: player.walkupSong.songName.toLowerCase(),
        artist: player.walkupSong.artistName.toLowerCase(),
        spotifyId: player.walkupSong.spotifyId || '',
        genres: (player.walkupSong.genre || []).map(g => g.toLowerCase())
      };
      
      // First check if this is a liked song - highest priority
      const isLikedSong = this.checkIfLikedSong(normalizedPlayerSong, savedTracksMap);
      
      // Find song and artist matches
      const songMatches = this.findAllSongMatches(normalizedPlayerSong, normalizedUserTracks, normalizedSavedTracks);
      const artistMatches = this.findAllArtistMatches(normalizedPlayerSong, normalizedUserTracks, normalizedUserArtists, savedTracksMap);
      
      // Calculate genre match with user's genre distribution
      const genreMatch = this.calculateGenreMatchScore(
        userTopGenres, 
        normalizedPlayerSong.genres,
        normalizedPlayerSong.artist,
        artistsWithLikedSongs
      );
      
      // Compile all match reasons
      const matchingReasons = new Map<string, MatchResult>();
      
      // Add liked song match if applicable
      if (isLikedSong) {
        matchingReasons.set('liked', { 
          score: this.SCORE_WEIGHTS.MATCH_TYPE.LIKED_SONG, 
          reason: 'Liked song' 
        });
      }
      
      // Add song matches
      songMatches.forEach(match => {
        const key = `song-${match.score}-${match.timeFrame || 'saved'}`;
        if (!matchingReasons.has(key) || match.score > (matchingReasons.get(key)?.score || 0)) {
          matchingReasons.set(key, match);
        }
      });
      
      // Add artist matches
      artistMatches.forEach(match => {
        const key = `artist-${match.score}-${match.timeFrame || 'unknown'}`;
        if (!matchingReasons.has(key) || match.score > (matchingReasons.get(key)?.score || 0)) {
          matchingReasons.set(key, match);
        }
      });
      
      // Add genre match if it exists
      if (genreMatch.score > 0) {
        matchingReasons.set('genre', genreMatch);
      }
      
      // Sort matches by score and take the best one
      const sortedMatches = Array.from(matchingReasons.values()).sort((a, b) => b.score - a.score);
      const bestMatch = sortedMatches[0] || { score: 0, reason: 'No match found', details: '' };
      
      // CHANGED: Check if the specific track is in liked tracks for non-song matches
      // If this is not already a liked song or top song match, check if it's in liked tracks
      if (bestMatch.reason !== 'Liked song' && bestMatch.reason !== 'Top song' && 
          this.checkIfLikedSong(normalizedPlayerSong, savedTracksMap)) {
        // Upgrade to a liked song match
        bestMatch.score = this.SCORE_WEIGHTS.MATCH_TYPE.LIKED_SONG;
        bestMatch.reason = 'Liked song';
      }
      
      let finalScore = bestMatch.score;

      // Add stats bonus (very small to not override music preferences)
      const STATS_BONUS_WEIGHT = 0.01; // 1% bonus at most
      let statsBonus = 0;
      
      if (player.position !== 'P') {
        // For non-pitchers, use OPS (On-base Plus Slugging)
        const ops = (player.stats?.batting?.onBasePercentage || 0) + (player.stats?.batting?.sluggingPercentage || 0);
        // Normalize OPS (typical range is 0.500 to 1.000)
        statsBonus = ((ops - 0.500) / 0.500) * STATS_BONUS_WEIGHT;
      } else {
        // For pitchers, use ERA (lower is better)
        const era = player.stats?.pitching?.earnedRunAvg || 0;
        if (era > 0) {
          // Normalize ERA (typical range is 1.00 to 6.00)
          statsBonus = ((6.00 - era) / 5.00) * STATS_BONUS_WEIGHT;
        }
      }
      
      // Ensure stats bonus is between 0 and STATS_BONUS_WEIGHT
      statsBonus = Math.max(0, Math.min(statsBonus, STATS_BONUS_WEIGHT));
      
      // Add bonus for multiple matches
      if (sortedMatches.length > 1) {
        finalScore *= (1 + this.SCORE_WEIGHTS.MULTIPLE_MATCHES_BONUS);
      }
      
      // Add stats bonus
      finalScore += statsBonus;
      
      console.log(`Player: ${player.playerName}, Initial Score: ${bestMatch.score.toFixed(2)}, Stats Bonus: ${statsBonus.toFixed(4)}, Final Score: ${finalScore.toFixed(2)}`);
      return {
        player,
        matchScore: finalScore,
        originalMatchScore: finalScore,
        matchReason: bestMatch.reason,
        rankInfo: bestMatch.details || '',
        matchingSongs: [{
          songName: player.walkupSong.songName,
          artistName: player.walkupSong.artistName,
          matchScore: bestMatch.score,
          matchReason: bestMatch.reason,
          rankInfo: bestMatch.details || '',
          albumArt: player.walkupSong.albumArt || '',
          previewUrl: player.walkupSong.previewUrl || undefined
        }]
      };
    }).filter(p => p.matchScore >= this.MIN_MATCH_SCORE)
      .sort((a, b) => b.matchScore - a.matchScore);

    console.log(`Found ${playersWithScores.length} players with match scores above threshold (phase 1)`);

    // ----- FIRST PASS: Greedy Assignment with Uniqueness -----
    // Now store assignments as objects containing candidate and the assigned slot.
    const team: { [position: string]: TeamAssignment } = {};
    const usedCandidateIds = new Set<string>();
    const usedSongNames = new Set<string>();

    for (const pos of positions) {
      const eligible = playersWithScores.filter(candidate =>
        this.isCandidateEligibleForPosition(candidate, pos) &&
        !usedCandidateIds.has(candidate.player.playerId) &&
        !usedSongNames.has(candidate.player.walkupSong.songName)
      );
      if (eligible.length > 0) {
        team[pos] = { candidate: eligible[0], assignedPosition: pos };
        usedCandidateIds.add(eligible[0].player.playerId);
        usedSongNames.add(eligible[0].player.walkupSong.songName);
      } else {
        console.warn(`No eligible candidate for position ${pos}`);
      }
    }

    // ----- SECOND PASS: Diversity Adjustment for Artists -----
    // Build an artist map from the current team.
    const artistMap: { [artist: string]: Array<{ position: Position; assignment: TeamAssignment }> } = {};
    for (const pos of positions) {
      const assignment = team[pos];
      if (!assignment) continue;
      const artist = assignment.candidate.player.walkupSong.artistName;
      if (!artistMap[artist]) {
        artistMap[artist] = [];
      }
      artistMap[artist].push({ position: pos, assignment });
    }
    // For any artist with duplicates, try to swap out lower-ranked ones.
    for (const artist in artistMap) {
      if (artistMap[artist].length > 1) {
        artistMap[artist].sort((a, b) => b.assignment.candidate.matchScore - a.assignment.candidate.matchScore);
        for (let i = 1; i < artistMap[artist].length; i++) {
          const { position, assignment } = artistMap[artist][i];
          let penaltyRate = 0;
          if (i === 1) penaltyRate = this.SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY.SECOND;
          else if (i === 2) penaltyRate = this.SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY.THIRD;
          else if (i === 3) penaltyRate = this.SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY.FOURTH;
          else penaltyRate = this.SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY.FIFTH_PLUS;
          const currentEffective = assignment.candidate.originalMatchScore * (1 - penaltyRate);
          // Look for alternatives whose artist is different and update the assigned position to this slot.
          const alternatives = playersWithScores.filter(c =>
            this.isCandidateEligibleForPosition(c, position) &&
            !usedCandidateIds.has(c.player.playerId) &&
            c.player.walkupSong.artistName !== artist
          );
          let bestAltEffective = 0;
          let bestAlternative: PlayerWithScore | null = null;
          for (const alt of alternatives) {
            const altArtist = alt.player.walkupSong.artistName;
            const altOccurrences = this.getArtistCountInTeam(altArtist, team);
            const altPenalty = this.computePenaltyMultiplier(altOccurrences);
            const altEffective = alt.originalMatchScore * (1 - altPenalty);
            if (altEffective > bestAltEffective) {
              bestAltEffective = altEffective;
              bestAlternative = alt;
            }
          }
          if (bestAlternative && bestAltEffective > currentEffective) {
            console.log(`Swapping position ${position}: replacing ${assignment.candidate.player.playerName} (${artist}, effective ${currentEffective.toFixed(2)}) with ${bestAlternative.player.playerName} (${bestAlternative.player.walkupSong.artistName}, effective ${bestAltEffective.toFixed(2)})`);
            team[position] = { candidate: bestAlternative, assignedPosition: position };
            usedCandidateIds.add(bestAlternative.player.playerId);
            usedSongNames.add(bestAlternative.player.walkupSong.songName);
          }
        }
      }
    }

    // ----- THIRD PASS: Song Uniqueness Adjustment -----
    const songMap: { [song: string]: Array<{ position: Position; assignment: TeamAssignment }> } = {};
    for (const pos of positions) {
      const assignment = team[pos];
      if (!assignment) continue;
      const song = assignment.candidate.player.walkupSong.songName;
      if (!songMap[song]) songMap[song] = [];
      songMap[song].push({ position: pos, assignment });
    }
    for (const song in songMap) {
      if (songMap[song].length > 1) {
        songMap[song].sort((a, b) => b.assignment.candidate.matchScore - a.assignment.candidate.matchScore);
        for (let i = 1; i < songMap[song].length; i++) {
          const { position } = songMap[song][i];
          const alternatives = playersWithScores.filter(c =>
            this.isCandidateEligibleForPosition(c, position) &&
            !usedCandidateIds.has(c.player.playerId) &&
            c.player.walkupSong.songName !== song
          );
          if (alternatives.length > 0) {
            const alternative = alternatives[0];
            console.log(`Replacing duplicate song at ${position}: "${song}" replaced with "${alternative.player.walkupSong.songName}"`);
            team[position] = { candidate: alternative, assignedPosition: position };
            usedCandidateIds.add(alternative.player.playerId);
            usedSongNames.add(alternative.player.walkupSong.songName);
          }
        }
      }
    }

    // Build final team array (using the assigned positions from our TeamAssignment objects)
    const finalTeam: PlayerWalkupSong[] = positions
      .map(pos => team[pos])
      .filter(Boolean)
      .map(assignment => this.createTeamPlayer(assignment.candidate, assignment.assignedPosition, assignment.candidate.matchScore));
    return finalTeam;
  }

  /**
   * Create a team player object using the candidate and the assigned position.
   */
  private createTeamPlayer(
    candidate: PlayerWithScore,
    assignedPosition: Position,
    adjustedScore: number
  ): PlayerWalkupSong {
    return {
      ...candidate.player,
      position: assignedPosition,
      matchReason: candidate.matchReason,
      rankInfo: candidate.rankInfo,
      matchScore: adjustedScore,
      matchingSongs: candidate.matchingSongs?.map(song => ({
        ...song,
        albumArt: song.albumArt || candidate.player.walkupSong.albumArt || '',
        previewUrl: song.previewUrl || candidate.player.walkupSong.previewUrl || undefined
      }))
    };
  }

  /**
   * Determines if a candidate is eligible for a given position.
   * Special handling for pitcher positions and DH.
   */
  private isCandidateEligibleForPosition(candidate: PlayerWithScore, position: Position): boolean {
    if (['SP', 'P1', 'P2', 'P3', 'P4', 'P'].includes(position as string)) {
      return candidate.player.position === 'P' || candidate.player.position === 'SP';
    } else if (position === 'DH') {
      const fallbackDH = this.FALLBACK_POSITIONS['DH'] || [];
      return candidate.player.position === 'DH' || fallbackDH.includes(candidate.player.position) ||
             (this.SIMILAR_POSITIONS['DH'] || []).includes(candidate.player.position);
    } else {
      if (candidate.player.position === position) return true;
      const compatible = this.COMPATIBLE_POSITIONS[position as string] || [];
      const similar = this.SIMILAR_POSITIONS[position as string] || [];
      return compatible.includes(candidate.player.position) || similar.includes(candidate.player.position);
    }
  }

  /**
   * Helper: Count how many times a given artist appears in the team.
   */
  private getArtistCountInTeam(artist: string, team: { [position: string]: TeamAssignment }): number {
    let count = 0;
    for (const pos in team) {
      if (team[pos].candidate.player.walkupSong.artistName === artist) {
        count++;
      }
    }
    return count;
  }

  /**
   * Compute penalty multiplier based on occurrence index (0-indexed).
   */
  private computePenaltyMultiplier(index: number): number {
    if (index === 0) return 0.0;
    if (index === 1) return this.SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY.SECOND;
    if (index === 2) return this.SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY.THIRD;
    if (index === 3) return this.SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY.FOURTH;
    return this.SCORE_WEIGHTS.ARTIST_DIVERSITY_PENALTY.FIFTH_PLUS;
  }

  /**
   * Find all possible song matches for a player.
   */
  private findAllSongMatches(
    playerSong: { name: string; artist: string; genres: string[] },
    userTracks: Record<TimeFrame, NormalizedTrack[]>,
    userSavedTracks: NormalizedTrack[]
  ): MatchResult[] {
    const matches: MatchResult[] = [];
    const timeFrames: TimeFrame[] = ['long_term', 'medium_term', 'short_term'];
    for (const timeFrame of timeFrames) {
      const tracks = userTracks[timeFrame];
      const matchedTrack = tracks.find(track => track.name === playerSong.name && track.artist === playerSong.artist);
      if (matchedTrack) {
        const rank = matchedTrack.rank || 0;
        const timeFrameBonus = this.SCORE_WEIGHTS.TIME_FRAME[timeFrame];
        let rankBonus = 0;
        if (rank <= 10) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_10;
        else if (rank <= 25) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_25;
        else if (rank <= 50) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_50;
        const score = this.SCORE_WEIGHTS.MATCH_TYPE.TOP_SONG + timeFrameBonus + rankBonus;
        const details = `#${rank} ${timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(timeFrame)}`}`;
        matches.push({ score, reason: 'Top song', details, rank, timeFrame });
      }
    }
    const savedMatch = userSavedTracks.find(track => track.name === playerSong.name && track.artist === playerSong.artist);
    if (savedMatch) {
      matches.push({ score: this.SCORE_WEIGHTS.MATCH_TYPE.LIKED_SONG, reason: 'Liked song' });
    }
    for (const timeFrame of timeFrames) {
      const tracks = userTracks[timeFrame];
      const partialMatches = tracks.filter(track => track.name === playerSong.name && track.artist !== playerSong.artist);
      if (partialMatches.length > 0) {
        const bestPartial = partialMatches.reduce((best, current) =>
          (current.rank || Infinity) < (best.rank || Infinity) ? current : best, partialMatches[0]);
        const rank = bestPartial.rank || 0;
        matches.push({
          score: this.SCORE_WEIGHTS.MATCH_TYPE.PARTIAL_SONG,
          reason: 'Partial song match (same title)',
          details: rank ? `#${rank} ${timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(timeFrame)}`}` : '',
          rank,
          timeFrame
        });
      }
    }
    return matches;
  }

  /**
   * Find all possible artist matches for a player.
   */
  private findAllArtistMatches(
    playerSong: { name: string; artist: string; spotifyId?: string },
    userTracks: Record<TimeFrame, NormalizedTrack[]>,
    userArtists: Record<TimeFrame, NormalizedArtist[]>,
    savedTracksMap: Map<string, boolean>
  ): MatchResult[] {
    const matches: MatchResult[] = [];
    const timeFrames: TimeFrame[] = ['long_term', 'medium_term', 'short_term'];
    
    for (const timeFrame of timeFrames) {
      const artists = userArtists[timeFrame];
      const matchedArtist = artists.find(artist => artist.name && playerSong.artist && artist.name === playerSong.artist);
      
      if (matchedArtist) {
        // Regular artist match scoring
        const rank = matchedArtist.rank || 0;
        const timeFrameBonus = this.SCORE_WEIGHTS.TIME_FRAME[timeFrame];
        let rankBonus = 0;
        if (rank <= 10) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_10;
        else if (rank <= 25) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_25;
        else if (rank <= 50) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_50;
        const rankPenalty = (timeFrame === 'medium_term' || timeFrame === 'long_term') && rank > 25 ? (rank - 25) * 0.01 : 0;
        const score = this.SCORE_WEIGHTS.MATCH_TYPE.TOP_ARTIST + timeFrameBonus + rankBonus - rankPenalty;
        const details = `#${rank} ${timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(timeFrame)}`}`;
        matches.push({ score, reason: 'Top artist', details, rank, timeFrame });
      }
    }
    
    // Handle partial artist matches
    for (const timeFrame of timeFrames) {
      const artists = userArtists[timeFrame];
      const partialMatches = artists.filter(artist =>
        artist.name && playerSong.artist &&
        artist.name !== playerSong.artist &&
        (artist.name.includes(playerSong.artist) || playerSong.artist.includes(artist.name))
      );
      if (partialMatches.length > 0) {
        const bestPartial = partialMatches.reduce((best, current) =>
          (current.rank || Infinity) < (best.rank || Infinity) ? current : best, partialMatches[0]);
        const rank = bestPartial.rank || 0;
        matches.push({
          score: this.SCORE_WEIGHTS.MATCH_TYPE.PARTIAL_ARTIST,
          reason: 'Partial artist match',
          details: rank ? `#${rank} ${timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(timeFrame)}`}` : '',
          rank,
          timeFrame
        });
      }
    }
    return matches;
  }

  /**
   * Calculate match score between user genres and player song genres.
   * Enhanced to match against user's genre distribution pattern.
   * Now also checks if the user has liked any songs by this artist to give a small boost.
   */
  private calculateGenreMatchScore(
    userGenres: Array<{ name: string; weight: number }>, 
    playerGenres: string[],
    playerArtist: string,
    artistsWithLikedSongs: Set<string>
  ): MatchResult {
    if (!playerGenres || playerGenres.length === 0) {
      return { score: 0, reason: 'No genre data available' };
    }
    
    // Find all matching genres
    const matches = userGenres
      .filter(userGenre =>
        playerGenres.some(playerGenre => this.areGenresSimilar(playerGenre, userGenre.name))
      )
      .map(match => ({ name: match.name, weight: match.weight }));
    
    if (matches.length === 0) {
      return { score: 0, reason: 'No genre matches' };
    }
    
    // Calculate base score using total weight from user's genre distribution
    const totalWeight = userGenres.reduce((sum, g) => sum + g.weight, 0);
    const matchWeight = matches.reduce((sum, m) => sum + m.weight, 0);
    
    // Calculate match score based on proportion of user's genre profile
    const matchScore = matchWeight / totalWeight;
    
    // Add a bonus for matching the user's top genres
    let topGenreBonus = 0;
    const userTopGenres = userGenres.slice(0, 3); // User's top 3 genres
    const matchesTopGenres = matches.filter(m => 
      userTopGenres.some(tg => tg.name === m.name)
    );
    
    if (matchesTopGenres.length > 0) {
      // Bonus scales with how many top genres match and their weights
      const topGenreMatchWeight = matchesTopGenres.reduce((sum, m) => sum + m.weight, 0);
      const topGenreTotalWeight = userTopGenres.reduce((sum, g) => sum + g.weight, 0);
      topGenreBonus = 0.1 * (topGenreMatchWeight / topGenreTotalWeight);
    }
    
    // Calculate diversity ratio - how well the player's genre diversity 
    // matches the user's genre diversity
    const userGenreDiversity = Math.min(userGenres.length, 10) / 10; // Normalized to 0-1
    const playerGenreDiversity = Math.min(playerGenres.length, 10) / 10; // Normalized to 0-1
    const diversityMatchRatio = 1 - Math.abs(userGenreDiversity - playerGenreDiversity);
    const diversityBonus = 0.05 * diversityMatchRatio;
    
    // NEW: Check if the user has liked any songs by this artist
    let artistLikedBonus = 0;
    if (artistsWithLikedSongs.has(playerArtist)) {
      artistLikedBonus = this.SCORE_WEIGHTS.GENRE_ARTIST_LIKED_BONUS;
    }
    
    // Calculate final score with all components
    const score = (matchScore * this.SCORE_WEIGHTS.MATCH_TYPE.GENRE) + 
                 topGenreBonus + 
                 diversityBonus + 
                 artistLikedBonus;
    
    // Create appropriate reason text
    let reason = '';
    if (matchScore >= 0.8) reason = `Strong genre match`;
    else if (matchScore >= 0.5) reason = `Good genre match`;
    else if (matchScore >= 0.3) reason = `Partial genre match`;
    else reason = `Minor genre match`;
    
    if (artistLikedBonus > 0) {
      reason += ' (artist in liked songs)';
    }
    
    // Add details about matching genres
    const details = matches.map(m => m.name).slice(0, 2).join(', ');
    
    return { score, reason, details };
  }

  /**
   * Check if two genres are similar.
   */
  private areGenresSimilar(genre1: string, genre2: string): boolean {
    const cacheKey = `${genre1}|${genre2}`;
    const reverseKey = `${genre2}|${genre1}`;
    if (this.genreSimilarityCache.has(cacheKey)) return this.genreSimilarityCache.get(cacheKey) as boolean;
    if (this.genreSimilarityCache.has(reverseKey)) return this.genreSimilarityCache.get(reverseKey) as boolean;
    if (genre1 === genre2) {
      this.genreSimilarityCache.set(cacheKey, true);
      return true;
    }
    if (genre1.includes(genre2) || genre2.includes(genre1)) {
      this.genreSimilarityCache.set(cacheKey, true);
      return true;
    }
    const variations: Record<string, string[]> = {
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
      if ((genre1 === mainGenre && relatedGenres.includes(genre2)) ||
          (genre2 === mainGenre && relatedGenres.includes(genre1))) {
        this.genreSimilarityCache.set(cacheKey, true);
        return true;
      }
    }
    this.genreSimilarityCache.set(cacheKey, false);
    return false;
  }

  /**
   * Calculate a bonus for genre variety.
   */
  private calculateGenreVarietyBonus(playerGenres: string[]): number {
    if (!playerGenres || playerGenres.length === 0) return 0;
    const uniqueGenres = new Set(playerGenres.map(g => g.toLowerCase()));
    const genreCount = Math.min(uniqueGenres.size, 5);
    const varietyBonus = genreCount * 0.02;
    return Math.min(varietyBonus, this.SCORE_WEIGHTS.GENRE_VARIETY_BONUS);
  }

  /**
   * Get a label for a given time frame.
   */
  private getTimeFrameLabel(timeFrame: TimeFrame): string {
    switch (timeFrame) {
      case 'short_term': return 'past 4 weeks';
      case 'medium_term': return 'past 6 months';
      case 'long_term': return 'all time';
      default: return '';
    }
  }

  /**
   * Check if a song is in the user's liked tracks.
   */
  private checkIfLikedSong(
    playerSong: { name: string; artist: string; spotifyId?: string },
    savedTracksMap: Map<string, boolean>
  ): boolean {
    if (playerSong.spotifyId && savedTracksMap.has(playerSong.spotifyId)) return true;
    const key = `${playerSong.name}|${playerSong.artist}`;
    return savedTracksMap.has(key);
  }
}