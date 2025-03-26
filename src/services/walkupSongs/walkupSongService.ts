import { PlayerWalkupSong, WalkupSongRepository } from '@/lib/walkupSongs/types';
import { SpotifyGenreSummary } from '@/services/spotify/spotifyService';
import { Position } from '@/lib/mlb/types';

/**
 * Service for matching user music preferences with walkup songs
 */
export class WalkupSongService {
  private repository: WalkupSongRepository;
  
  constructor(repository: WalkupSongRepository) {
    this.repository = repository;
  }
  
  /**
   * Find the best player for each position based on genre matching
   */
  async findTeamByGenrePreferences(
    userGenres: SpotifyGenreSummary[],
    positions: Position[]
  ): Promise<PlayerWalkupSong[]> {
    const allPlayerSongs = await this.repository.getAllPlayerSongs();
    const team: PlayerWalkupSong[] = [];
    
    // Extract top genres from user preferences
    const userTopGenres = userGenres.slice(0, 10).map(g => g.name);
    
    // For each position, find the best matching player
    for (const position of positions) {
      const positionPlayers = allPlayerSongs.filter(p => 
        p.position.toUpperCase() === position
      );
      
      if (positionPlayers.length === 0) continue;
      
      // Calculate match scores for each player
      const playersWithScores = positionPlayers.map(player => {
        const playerGenres = player.walkupSong.genre;
        const matchScore = this.calculateGenreMatchScore(userTopGenres, playerGenres);
        return { player, matchScore };
      });
      
      // Sort by match score (descending)
      playersWithScores.sort((a, b) => b.matchScore - a.matchScore);
      
      // Get the best matching player for this position
      if (playersWithScores.length > 0) {
        team.push(playersWithScores[0].player);
      }
    }
    
    return team;
  }
  
  /**
   * Calculate match score between user genres and player song genres
   */
  private calculateGenreMatchScore(userGenres: string[], playerGenres: string[]): number {
    const matches = userGenres.filter(userGenre => 
      playerGenres.some(playerGenre => 
        playerGenre.toLowerCase().includes(userGenre.toLowerCase()) || 
        userGenre.toLowerCase().includes(playerGenre.toLowerCase())
      )
    );
    
    return matches.length / Math.max(userGenres.length, 1);
  }
}