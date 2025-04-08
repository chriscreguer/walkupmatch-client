import axios from 'axios';
import mongoose from 'mongoose';
import cron from 'node-cron';
import { PlayerWalkupSong, WalkupSong } from '@/lib/walkupSongs/types';
import { SpotifyGenreSummary, SpotifyTopItem } from '@/services/spotify/spotifyService';
import { Position } from '@/lib/mlb/types';
import { MySportsFeedsService } from '@/services/mySportsFeeds/mySportsFeedsService';
import { TeamStatsModel } from '@/models/teamStatsModel';

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
    artists: [{
      name: { type: String, required: true },
      role: { type: String, enum: ['primary', 'featured'], required: true }
    }],
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
  },
  walkupSongs: [{
    id: { type: String, required: true },
    songName: { type: String, required: true },
    artistName: { type: String, required: true },
    artists: [{
      name: { type: String, required: true },
      role: { type: String, enum: ['primary', 'featured'], required: true }
    }],
    albumName: String,
    spotifyId: String,
    youtubeId: String,
    genre: [String],
    albumArt: String
  }]
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
    artists: Array<{
      name: string;
      role: 'primary' | 'featured';
    }>;
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
  walkupSongs: Array<{
    id: string;
    songName: string;
    artistName: string;
    artists: Array<{
      name: string;
      role: 'primary' | 'featured';
    }>;
    albumName: string;
    spotifyId?: string;
    youtubeId?: string;
    genre: string[];
    albumArt?: string;
  }>;
}

// Matching data types
interface NormalizedTrack {
  name: string;
  artist: string;
  spotifyId?: string;
  albumId?: string;
  albumName?: string;
  rank?: number;
  timeFrame?: TimeFrame;
}

interface NormalizedArtist {
  name: string;
  id?: string;
  rank?: number;
  timeFrame?: TimeFrame;
}

interface NormalizedAlbum {
  id: string;
  name: string;
  artistName: string;
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
  savedAlbumMatch?: boolean; // New field to track album matches
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
  private readonly SECONDARY_SONG_THRESHOLD = 1; // Higher threshold for secondary songs
  private usedSongs: Set<string> = new Set();
  private usedArtists: Map<string, number> = new Map(); // Track artist occurrences
  private genreSimilarityCache: Map<string, boolean> = new Map();
  private readonly MULTIPLE_SONG_BONUS = 0.03; // 3% bonus per additional qualifying song
  private tigersGamesPlayed: number | null = null;

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
      LIKED_SONG: 1.2,
      TOP_SONG: 1.5,
      TOP_ARTIST: 0.8,
      FEATURE: 0.6, // Feature match type (between artist and genre)
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
    MULTIPLE_MATCHES_BONUS: 0.03, // Bonus for multiple match reasons
    GENRE_VARIETY_BONUS: 0.15,
    // Small bonus for genre matches where user has liked songs by the artist
    GENRE_ARTIST_LIKED_BONUS: 0.05,
    // New: Bonus for exact genre match (vs similar genre)
    EXACT_GENRE_MATCH_BONUS: 0.05,
    // New: Very small bonus for saved album tie-breaker
    SAVED_ALBUM_BONUS: 0.02
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

      // Try to find an existing player document by its API id.
      const existingPlayer = await Player.findOne({ id: player.data.id });

      // Parse the incoming song data from the API.
      const newSong = player.data.songs?.[0]
        ? (() => {
            const song = player.data.songs[0];
            const originalArtistString = song.artists?.join(', ') || 'Unknown';
            const parsedArtists = [];
            if (song.artists && Array.isArray(song.artists) && song.artists.length > 0) {
              // First artist is primary; subsequent artists are featured.
              parsedArtists.push({ name: song.artists[0], role: 'primary' });
              for (let i = 1; i < song.artists.length; i++) {
                parsedArtists.push({ name: song.artists[i], role: 'featured' });
              }
            } else {
              parsedArtists.push({ name: 'Unknown', role: 'primary' });
            }
            return {
              id: song.id,
              songName: song.title,
              artistName: originalArtistString,
              artists: parsedArtists,
              albumName: 'Unknown',
              spotifyId: null,
              youtubeId: null,
              genre: [],
              albumArt: song.spotify_image || null
            };
          })()
        : null;

      // If there is no new song data, exit early.
      if (!newSong) {
        console.log("No song data available in API response.");
        return;
      }

      if (existingPlayer) {
        // Check whether this new song is already in the walkupSongs array.
        const songAlreadyExists = existingPlayer.walkupSongs.some(
          (song: { id: string }) => song.id === newSong.id
        );

        // Build the update object, explicitly omitting position
        const updateObj = {
          mlbId: player.data.mlb_id,
          name: player.data.name,
          team: player.data.team?.name || 'Unknown',
          teamId: player.data.team?.id || 'Unknown',
          lastUpdated: new Date()
        };

        // Only add the song to walkupSongs if it isn't already present.
        const updateQuery = {
          $set: updateObj,
          ...(!songAlreadyExists ? { $addToSet: { walkupSongs: newSong } } : {})
        };

        await Player.updateOne({ id: player.data.id }, updateQuery);
      } else {
        // For a new player, create a document with an empty position
        const newPlayer = new Player({
          id: player.data.id,
          mlbId: player.data.mlb_id,
          name: player.data.name,
          position: '', // Set empty position for new players
          team: player.data.team?.name || 'Unknown',
          teamId: player.data.team?.id || 'Unknown',
          lastUpdated: new Date(),
          walkupSongs: [newSong]
        });
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
      return players.map(player => {
        // Get all walkup songs (both from walkupSong field and walkupSongs array)
        const allWalkupSongs = [
          player.walkupSong,
          ...(player.walkupSongs || [])
        ].filter(Boolean);

        // Process each walkup song
        const processedWalkupSongs = allWalkupSongs.map(song => ({
          id: song.id || 'no-song',
          songName: song.songName || 'No walkup song',
          artistName: song.artistName || 'Unknown',
          artists: song.artists || [{ name: 'Unknown', role: 'primary' }],
          albumName: song.albumName || '',
          spotifyId: song.spotifyId || '',
          youtubeId: song.youtubeId || '',
          genre: song.genre || [],
          albumArt: song.albumArt || ''
        }));

        return {
          playerId: player.id,
          playerName: player.name,
          position: player.position,
          team: player.team,
          teamId: player.teamId,
          walkupSong: processedWalkupSongs[0], // Keep the first song as the primary walkup song
          walkupSongs: processedWalkupSongs, // Include all walkup songs
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
        };
      });
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
          artists: player.walkupSong.artists || [{ name: 'Unknown', role: 'primary' }],
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
            artists: player.walkupSong.artists || [{ name: 'Unknown', role: 'primary' }],
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
    positions: Position[],
    userSavedAlbums: SpotifyTopItem[] = []
  ): Promise<PlayerWalkupSong[]> {
    // Get Tigers' games played for validation
    try {
      const teamStats = await TeamStatsModel.findOne({ teamId: 'det' });
      if (teamStats) {
        this.tigersGamesPlayed = teamStats.gamesPlayed;
        console.log(`Using Tigers' games played for validation: ${this.tigersGamesPlayed}`);
      } else {
        this.tigersGamesPlayed = 10; // Default fallback
        console.log('No Tigers stats found, using default games played threshold');
      }
    } catch (error) {
      console.error('Error fetching Tigers games played:', error);
      this.tigersGamesPlayed = 10; // Default fallback on error
    }

    // Reset caches
    this.usedSongs.clear();
    this.usedArtists.clear();
    this.genreSimilarityCache.clear();

    // Get and filter player data
    const allPlayerSongs = await this.getAllPlayers();
    console.log('Total players before filtering:', allPlayerSongs.length);
    
    // Validate all players' stats first
    const validationResults = await Promise.all(
      allPlayerSongs.map(async player => {
        const isValid = await this.validatePlayerStats(player);
        if (!isValid) {
        
        }
        return { player, isValid };
      })
    );
    
    const validPlayers = validationResults
      .filter(({ player, isValid }) => {
        // Basic walkup song validation
        const hasValidWalkupSong = player.walkupSong &&
          player.walkupSong.songName &&
          player.walkupSong.artistName &&
          player.walkupSong.songName !== 'No walkup song';
        
        if (!hasValidWalkupSong) {
        
          return false;
        }

        if (!isValid) {
         
          return false;
        }
        
     
        return true;
      })
      .map(({ player }) => player);
    
    console.log('Players after filtering:', validPlayers.length);


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
        albumId: track.album?.id,
        albumName: track.album?.name || '',
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
      spotifyId: track.id,
      albumId: track.album?.id,
      albumName: track.album?.name || ''
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

    // NEW: Create a map of artists with saved albums
    const normalizedSavedAlbums: NormalizedAlbum[] = userSavedAlbums.map(album => ({
      id: album.id || '',
      name: (album.name || '').toLowerCase(),
      artistName: (album.artists?.[0]?.name || '').toLowerCase()
    }));
    
    const artistsWithSavedAlbums = new Set<string>();
    normalizedSavedAlbums.forEach(album => {
      if (album.artistName) {
        artistsWithSavedAlbums.add(album.artistName);
      }
    });

    // Calculate match scores for valid players
    const playersWithScores: PlayerWithScore[] = validPlayers.map(player => {
      if (!player.walkupSongs || player.walkupSongs.length === 0) {
        return {
          player,
          matchScore: 0,
          originalMatchScore: 0,
          matchReason: 'No walkup songs',
          rankInfo: '',
          matchingSongs: []
        };
      }

      // Process each walkup song and find its best match
      const matchingSongs = player.walkupSongs.map(song => {
        const normalizedPlayerSong = {
          name: song.songName.toLowerCase(),
          artist: song.artistName.toLowerCase(),
          spotifyId: song.spotifyId || '',
          genres: (song.genre || []).map(g => g.toLowerCase())
        };
        
        // Find all possible matches for this song
        const songMatches = this.findAllSongMatches(normalizedPlayerSong, normalizedUserTracks, normalizedSavedTracks);
        const artistMatches = this.findAllArtistMatches(normalizedPlayerSong, normalizedUserTracks, normalizedUserArtists, savedTracksMap);
        const genreMatch = this.calculateGenreMatchScore(
          userTopGenres, 
          normalizedPlayerSong.genres,
          normalizedPlayerSong.artist,
          artistsWithLikedSongs
        );
        
        // Get the best match for this song
        const allMatches = [
          ...songMatches,
          ...artistMatches,
          genreMatch.score > 0 ? genreMatch : null
        ].filter(Boolean) as MatchResult[];
        
        const bestMatch = allMatches.sort((a, b) => b.score - a.score)[0] || { 
          score: 0, 
          reason: 'No match found',
          details: ''
        };

        return {
          songName: song.songName,
          artistName: song.artistName,
          matchScore: bestMatch.score,
          matchReason: bestMatch.reason,
          rankInfo: bestMatch.details || '',
          albumArt: song.albumArt || '',
          previewUrl: song.previewUrl || undefined
        };
      });

      // Sort songs by match score
      const sortedSongs = matchingSongs.sort((a, b) => b.matchScore - a.matchScore);
      
      // Get the primary song (highest scoring)
      const primarySong = sortedSongs[0];
      
      // Filter secondary songs with higher threshold
      const secondarySongs = sortedSongs.slice(1).filter(song => 
        song.matchScore >= this.SECONDARY_SONG_THRESHOLD
      );
      
      // Combine primary and qualifying secondary songs
      const qualifyingSongs = [primarySong, ...secondarySongs];

      // Calculate base player score (highest match score among all songs)
      const basePlayerScore = Math.max(...qualifyingSongs.map(s => s.matchScore));
      
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
      
      // Calculate final player score (base score + stats bonus)
      const finalPlayerScore = basePlayerScore + statsBonus;
      
      return {
        player,
        matchScore: finalPlayerScore,
        originalMatchScore: finalPlayerScore,
        matchReason: primarySong.matchReason,
        rankInfo: primarySong.rankInfo,
        matchingSongs: qualifyingSongs
      };
    }).filter(p => p.matchScore >= this.MIN_MATCH_SCORE)
      .sort((a, b) => b.matchScore - a.matchScore);

    // ----- FIRST PASS: Greedy Assignment with Uniqueness -----
    const team: { [position: string]: TeamAssignment } = {};
    const usedCandidateIds = new Set<string>();
    const usedSongNames = new Set<string>();
    const usedArtists = new Map<string, number>();

    // Group players by position for position-specific processing
    const playersByPosition: Record<string, PlayerWithScore[]> = {};
    
    // First, organize players by position
    for (const player of playersWithScores) {
      const pos = player.player.position;
      if (!playersByPosition[pos]) {
        playersByPosition[pos] = [];
      }
      playersByPosition[pos].push(player);
    }

    // For each position, select the best candidate that doesn't have duplicate songs or too many of the same artist
    for (const pos of positions) {
      const eligible = playersWithScores.filter(candidate =>
        this.isCandidateEligibleForPosition(candidate, pos) &&
        !usedCandidateIds.has(candidate.player.playerId)
      );

      if (eligible.length > 0) {
        // Sort by score and find the best non-duplicate candidate
        const sortedEligible = eligible.sort((a, b) => b.matchScore - a.matchScore);
        
        for (const candidate of sortedEligible) {
          // Check for duplicate songs
          const hasDuplicateSong = candidate.matchingSongs.some(song => 
            usedSongNames.has(`${song.songName.toLowerCase()}|${song.artistName.toLowerCase()}`)
          );
          
          if (hasDuplicateSong) continue;

          // Check artist diversity
          const artistCounts = new Map<string, number>();
          candidate.matchingSongs.forEach(song => {
            const artistKey = song.artistName.toLowerCase();
            artistCounts.set(artistKey, (artistCounts.get(artistKey) || 0) + 1);
          });

          let artistPenalty = 0;
          for (const [artist, count] of artistCounts) {
            const existingCount = usedArtists.get(artist) || 0;
            if (existingCount > 0) {
              artistPenalty += this.computePenaltyMultiplier(existingCount) * count;
            }
          }

          // Apply artist penalty to score
          const adjustedScore = candidate.matchScore * (1 - artistPenalty);
          
          // If the adjusted score is still good enough, select this candidate
          if (adjustedScore >= this.MIN_MATCH_SCORE) {
            team[pos] = { candidate, assignedPosition: pos };
            usedCandidateIds.add(candidate.player.playerId);
            
            // Update used songs and artists
            candidate.matchingSongs.forEach(song => {
              const songKey = `${song.songName.toLowerCase()}|${song.artistName.toLowerCase()}`;
              usedSongNames.add(songKey);
              
              const artistKey = song.artistName.toLowerCase();
              usedArtists.set(artistKey, (usedArtists.get(artistKey) || 0) + 1);
            });
            
            break;
          }
        }
      }
    }

    // Build final team array
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
   * NEW: Check if an artist has any saved albums by the user
   */
  private checkArtistHasSavedAlbum(artistName: string, artistsWithSavedAlbums: Set<string>): boolean {
    // Split artist string by commas to handle multiple artists
    const artistList = artistName.split(',').map(a => a.trim().toLowerCase());
    
    // Check each artist individually
    for (const artist of artistList) {
      if (artistsWithSavedAlbums.has(artist)) {
        return true;
      }
    }
    
    return false;
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
    
    // Find exact song matches
    for (const timeFrame of timeFrames) {
      const tracks = userTracks[timeFrame];
      // Check for matches with any artist from the player's song
      const artistList = playerSong.artist.split(',').map(a => a.trim().toLowerCase());
      
      for (const artistName of artistList) {
        const matchedTrack = tracks.find(track => 
          track.name === playerSong.name && track.artist === artistName);
        
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
    }
    
    // Check for song in user's saved tracks
    const artistList = playerSong.artist.split(',').map(a => a.trim().toLowerCase());
    for (const artistName of artistList) {
      const savedMatch = userSavedTracks.find(track => 
        track.name === playerSong.name && track.artist === artistName);
      
      if (savedMatch) {
        matches.push({ 
          score: this.SCORE_WEIGHTS.MATCH_TYPE.LIKED_SONG, 
          reason: 'Liked song' 
        });
        break; // No need to check other artists if we found a match
      }
    }
    
    return matches;
  }

  /**
   * Find all possible artist matches for a player.
   */
  private findAllArtistMatches(
    playerSong: { name: string; artist: string; spotifyId?: string; artists?: Array<{ name: string; role: string }> },
    userTracks: Record<TimeFrame, NormalizedTrack[]>,
    userArtists: Record<TimeFrame, NormalizedArtist[]>,
    _savedTracksMap: Map<string, boolean>
  ): MatchResult[] {
    const matches: MatchResult[] = [];
    const timeFrames: TimeFrame[] = ['long_term', 'medium_term', 'short_term'];
    
    // Check for feature match in song title first
    const featureMatches = this.checkForFeatureMatch(playerSong.name, userArtists);
    if (featureMatches.length > 0) {
      matches.push(...featureMatches);
    }
    
    // Get artist list, preferring structured data if available
    const artistList = playerSong.artists && playerSong.artists.length > 0
      ? playerSong.artists.map(a => ({
          name: a.name.toLowerCase(),
          role: a.role
        }))
      : playerSong.artist.split(',').map(a => ({
          name: a.trim().toLowerCase(),
          role: 'primary' // Default to primary for backward compatibility
        }));
    
    // Track matches for multiple artist bonus calculation
    const matchedArtists = new Map<string, { score: number; rank: number; timeFrame: TimeFrame }>();
    
    // Check each artist individually
    for (const artist of artistList) {
      let bestMatch: { score: number; rank: number; timeFrame: TimeFrame } | null = null;
      
      for (const timeFrame of timeFrames) {
        const artists = userArtists[timeFrame];
        // Find exact artist match
        const matchedArtist = artists.find(userArtist => 
          userArtist.name && artist.name && userArtist.name === artist.name);
        
        if (matchedArtist) {
          // Regular artist match scoring with role consideration
          const rank = matchedArtist.rank || 0;
          const timeFrameBonus = this.SCORE_WEIGHTS.TIME_FRAME[timeFrame];
          let rankBonus = 0;
          if (rank <= 10) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_10;
          else if (rank <= 25) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_25;
          else if (rank <= 50) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_50;
          
          // Adjust score based on artist role
          const roleMultiplier = artist.role === 'primary' ? 1.0 : 0.8;
          const rankPenalty = (timeFrame === 'medium_term' || timeFrame === 'long_term') && rank > 25 ? (rank - 25) * 0.01 : 0;
          const baseScore = this.SCORE_WEIGHTS.MATCH_TYPE.TOP_ARTIST + timeFrameBonus + rankBonus - rankPenalty;
          const score = baseScore * roleMultiplier;
          
          // Only keep the best match for this artist across all timeframes
          if (!bestMatch || score > bestMatch.score) {
            bestMatch = { score, rank, timeFrame };
          }
        }
      }
      
      if (bestMatch) {
        matchedArtists.set(artist.name, bestMatch);
        
        const details = `#${bestMatch.rank} ${bestMatch.timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(bestMatch.timeFrame)}`}`;
        matches.push({ 
          score: bestMatch.score, 
          reason: artist.role === 'primary' ? 'Top artist' : 'Featured artist', 
          details, 
          rank: bestMatch.rank, 
          timeFrame: bestMatch.timeFrame 
        });
      }
    }
    
    // Add multiple artist bonus if we have more than one unique artist match
    if (matchedArtists.size > 1) {
      // Log details about multiple artist matches
      console.log(`\nMultiple artist matches found for song: ${playerSong.name}`);
      console.log('Song artists:', artistList.map(a => `${a.name} (${a.role})`).join(', '));
      console.log('Matched artists:', Array.from(matchedArtists.entries()).map(([name, match]) => 
        `${name}: #${match.rank} in ${match.timeFrame} (score: ${match.score})`
      ).join(', '));
      
      // Sort matches by score to get the highest scoring match
      const sortedMatches = Array.from(matchedArtists.values()).sort((a, b) => b.score - a.score);
      const highestScore = sortedMatches[0].score;
      
      // Calculate bonus based on number of unique artist matches and their quality
      let multipleArtistBonus = 0;
      for (let i = 1; i < sortedMatches.length; i++) {
        // Each additional unique artist match contributes less to the bonus
        const match = sortedMatches[i];
        const qualityFactor = match.rank <= 25 ? 1.0 : 0.5; // Higher quality matches contribute more
        multipleArtistBonus += (this.SCORE_WEIGHTS.MULTIPLE_MATCHES_BONUS * qualityFactor) / i;
      }
      
      // Add the bonus to the highest scoring match
      if (multipleArtistBonus > 0) {
        const bestMatch = matches.find(m => 
          m.score === highestScore && 
          m.reason.includes('Top artist') || m.reason.includes('Featured artist')
        );
        if (bestMatch) {
          bestMatch.score += multipleArtistBonus;
          bestMatch.reason += ` (${matchedArtists.size} unique artists)`;
        }
      }
    }
    
    return matches;
  }

  /**
   * Check for featured artists in song titles
   */
  private checkForFeatureMatch(
    songTitle: string,
    userArtists: Record<TimeFrame, NormalizedArtist[]>
  ): MatchResult[] {
    const matches: MatchResult[] = [];
    const featurePatterns = [
      /\(feat\.\s+([^)]+)\)/i,
      /\(ft\.\s+([^)]+)\)/i,
      /\(with\s+([^)]+)\)/i,
      /feat\.\s+([^,]+)/i,
      /ft\.\s+([^,]+)/i,
      /with\s+([^,&]+)/i
    ];
    
    // Extract potential featured artists from song title
    const featuredArtists: string[] = [];
    for (const pattern of featurePatterns) {
      const match = songTitle.match(pattern);
      if (match && match[1]) {
        // Handle multiple artists in feature credit
        const artists = match[1].split(/,|&/).map(a => a.trim().toLowerCase());
        featuredArtists.push(...artists);
      }
    }
    
    if (featuredArtists.length === 0) {
      return matches;
    }
    
    // Check if any featured artist matches user's top artists
    const timeFrames: TimeFrame[] = ['long_term', 'medium_term', 'short_term'];
    for (const featuredArtist of featuredArtists) {
      for (const timeFrame of timeFrames) {
        const artists = userArtists[timeFrame];
        const matchedArtist = artists.find(artist => 
          artist.name && artist.name.toLowerCase() === featuredArtist.toLowerCase());
        
        if (matchedArtist) {
          const rank = matchedArtist.rank || 0;
          const timeFrameBonus = this.SCORE_WEIGHTS.TIME_FRAME[timeFrame];
          let rankBonus = 0;
          if (rank <= 10) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_10;
          else if (rank <= 25) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_25;
          else if (rank <= 50) rankBonus = this.SCORE_WEIGHTS.RANK.TOP_50;
          const score = this.SCORE_WEIGHTS.MATCH_TYPE.FEATURE + timeFrameBonus + rankBonus;
          const details = `Featured artist #${rank} ${timeFrame === 'long_term' ? 'all time' : `in ${this.getTimeFrameLabel(timeFrame)}`}`;
          matches.push({ score, reason: 'Featured artist', details, rank, timeFrame });
        }
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
    
    // Find all matching genres, distinguishing between exact and similar matches
    const exactMatches: Array<{ name: string; weight: number }> = [];
    const similarMatches: Array<{ name: string; weight: number }> = [];
    
    // Process each user genre to find both exact and similar matches
    userGenres.forEach(userGenre => {
      // Check for exact match first
      const hasExactMatch = playerGenres.some(
        playerGenre => playerGenre.toLowerCase() === userGenre.name.toLowerCase()
      );
      
      if (hasExactMatch) {
        exactMatches.push(userGenre);
      } else {
        // If no exact match, check for similar genre
        const hasSimilarMatch = playerGenres.some(
          playerGenre => this.areGenresSimilar(playerGenre, userGenre.name)
        );
        
        if (hasSimilarMatch) {
          similarMatches.push(userGenre);
        }
      }
    });
    
    // Combine matches, but give a boost to exact matches
    const allMatches = [
      ...exactMatches.map(m => ({ ...m, isExact: true })),
      ...similarMatches.map(m => ({ ...m, isExact: false }))
    ];
    
    if (allMatches.length === 0) {
      return { score: 0, reason: 'No genre matches' };
    }
    
    // Calculate base score using total weight from user's genre distribution
    const totalWeight = userGenres.reduce((sum, g) => sum + g.weight, 0);
    const exactMatchWeight = exactMatches.reduce((sum, m) => sum + m.weight, 0);
    const similarMatchWeight = similarMatches.reduce((sum, m) => sum + m.weight, 0);
    
    // Give more weight to exact matches in the score calculation
    const weightedMatchScore = (exactMatchWeight * (1 + this.SCORE_WEIGHTS.EXACT_GENRE_MATCH_BONUS) + similarMatchWeight) / totalWeight;
    
    // Add a bonus for matching the user's top genres
    let topGenreBonus = 0;
    const userTopGenres = userGenres.slice(0, 3); // User's top 3 genres
    const matchesTopGenres = allMatches.filter(m => 
      userTopGenres.some(tg => tg.name === m.name)
    );
    
    if (matchesTopGenres.length > 0) {
      // Bonus scales with how many top genres match and their weights
      const topGenreMatchWeight = matchesTopGenres.reduce((sum, m) => sum + m.weight, 0);
      const topGenreTotalWeight = userTopGenres.reduce((sum, g) => sum + g.weight, 0);
      topGenreBonus = 0.1 * (topGenreMatchWeight / topGenreTotalWeight);
      
      // Give extra bonus for exact top genre matches
      const exactTopMatches = matchesTopGenres.filter(m => m.isExact);
      if (exactTopMatches.length > 0) {
        topGenreBonus += 0.05 * (exactTopMatches.length / matchesTopGenres.length);
      }
    }
    
    // Calculate diversity ratio - how well the player's genre diversity 
    // matches the user's genre diversity
    const userGenreDiversity = Math.min(userGenres.length, 10) / 10; // Normalized to 0-1
    const playerGenreDiversity = Math.min(playerGenres.length, 10) / 10; // Normalized to 0-1
    const diversityMatchRatio = 1 - Math.abs(userGenreDiversity - playerGenreDiversity);
    const diversityBonus = 0.05 * diversityMatchRatio;
    
    // Check if the user has liked any songs by this artist
    let artistLikedBonus = 0;
    const artistList = playerArtist.split(',').map(a => a.trim().toLowerCase());
    for (const artistName of artistList) {
      if (artistsWithLikedSongs.has(artistName)) {
        artistLikedBonus = this.SCORE_WEIGHTS.GENRE_ARTIST_LIKED_BONUS;
        break;
      }
    }
    
    // Calculate final score with all components
    const score = (weightedMatchScore * this.SCORE_WEIGHTS.MATCH_TYPE.GENRE) + 
                 topGenreBonus + 
                 diversityBonus + 
                 artistLikedBonus;
    
    // Create appropriate reason text
    let reason = '';
    if (exactMatches.length > 0) {
      if (weightedMatchScore >= 0.8) reason = `Strong exact genre match`;
      else if (weightedMatchScore >= 0.5) reason = `Good exact genre match`;
      else if (weightedMatchScore >= 0.3) reason = `Partial exact genre match`;
      else reason = `Minor exact genre match`;
    } else {
      if (weightedMatchScore >= 0.8) reason = `Strong genre match`;
      else if (weightedMatchScore >= 0.5) reason = `Good genre match`;
      else if (weightedMatchScore >= 0.3) reason = `Partial genre match`;
      else reason = `Minor genre match`;
    }
    
    if (artistLikedBonus > 0) {
      reason += ' (artist in liked songs)';
    }
    
    // Add details about matching genres, showing exact matches first
    const exactMatchNames = exactMatches.map(m => m.name);
    const similarMatchNames = similarMatches.map(m => m.name);
    
    let details = '';
    if (exactMatchNames.length > 0) {
      details += exactMatchNames.slice(0, 2).join(', ');
      if (similarMatchNames.length > 0 && exactMatchNames.length < 2) {
        details += ', ' + similarMatchNames.slice(0, 2 - exactMatchNames.length).join(', ');
      }
    } else {
      details = similarMatchNames.slice(0, 2).join(', ');
    }
    
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
    
    // Check for all artists in case of multiple artists
    const artistList = playerSong.artist.split(',').map(a => a.trim().toLowerCase());
    
    for (const artistName of artistList) {
      const key = `${playerSong.name}|${artistName}`;
      if (savedTracksMap.has(key)) return true;
    }
    
    return false;
  }

  private async validatePlayerStats(player: PlayerDocument | PlayerWalkupSong): Promise<boolean> {
    try {
      // Get player name for logging
      const playerName = 'playerName' in player ? player.playerName : player.name;
      
      // Non-pitchers need at least 1 PA per game
      if (!player.position.includes('P')) {
        const minPA = this.tigersGamesPlayed * 1;
        const currentPA = player.stats?.batting?.plateAppearances || 0;
        if (currentPA < minPA) {
          return false;
        }
        return true;
      }
      
      // Pitchers need at least 1 IP per game
      const minIP = (this.tigersGamesPlayed * .4);
      const currentIP = player.stats?.pitching?.inningsPitched || 0;
      if (currentIP < minIP) {
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error validating player stats:', error);
      return false;
    }
  }
}