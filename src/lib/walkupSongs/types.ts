/**
 * Core types for walkup song data
 */

export interface WalkupSong {
    id: string;
    songName: string;
    artistName: string;
    albumName?: string;
    spotifyId?: string;
    youtubeId?: string;
    genre: string[];
    albumArt?: string;
  }
  
  export interface PlayerWalkupSong {
    playerId: string;
    playerName: string;
    position: string;
    team: string;
    teamId: string;
    walkupSong: WalkupSong;
    matchReason?: string;
    rankInfo?: string;
    matchScore?: number;
  }
  
  /**
   * Repository interface for walkup song data
   * This abstraction allows us to easily swap between data sources (Excel, API, etc.)
   */
  export interface WalkupSongRepository {
    /**
     * Get all walkup songs for all players
     */
    getAllPlayerSongs(): Promise<PlayerWalkupSong[]>;
    
    /**
     * Get walkup songs filtered by team
     */
    getPlayerSongsByTeam(teamId: string): Promise<PlayerWalkupSong[]>;
    
    /**
     * Get walkup songs filtered by position
     */
    getPlayerSongsByPosition(position: string): Promise<PlayerWalkupSong[]>;
    
    /**
     * Get walkup song for a specific player
     */
    getPlayerSongById(playerId: string): Promise<PlayerWalkupSong | null>;
    
    /**
     * Get walkup songs filtered by genre
     */
    getPlayerSongsByGenre(genre: string): Promise<PlayerWalkupSong[]>;
  }