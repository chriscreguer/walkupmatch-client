import { PlayerWalkupSong, WalkupSongRepository } from '@/lib/walkupSongs/types';
import { SpotifyGenreSummary, SpotifyTopItem } from '@/services/spotify/spotifyService';
import { Position } from '@/lib/mlb/types';

/**
 * Service for matching user music preferences with walkup songs
 */
export class WalkupSongService {
  private repository: WalkupSongRepository;
  private readonly MIN_MATCH_SCORE = 0.1;
  
  constructor(repository: WalkupSongRepository) {
    this.repository = repository;
  }
  
  /**
   * Find the best player for each position based on multiple matching criteria
   */
  async findTeamByPreferences(
    userGenres: SpotifyGenreSummary[],
    userTopTracks: SpotifyTopItem[],
    userTopArtists: SpotifyTopItem[],
    userSavedTracks: SpotifyTopItem[],
    positions: Position[]
  ): Promise<PlayerWalkupSong[]> {
    const allPlayerSongs = await this.repository.getAllPlayerSongs();
    const team: PlayerWalkupSong[] = [];
    
    // Log user's top genres
    console.log('User top genres:', userGenres.slice(0, 10).map(g => `${g.name} (${g.weight.toFixed(2)})`));
    
    // Extract top genres from user preferences with their weights
    const userTopGenres = userGenres.slice(0, 10).map(g => ({
      name: g.name,
      weight: g.weight
    }));
    
    // Normalize user's music data for matching
    const userTracks = this.normalizeTracks(userTopTracks);
    const userArtists = this.normalizeArtists(userTopArtists);
    const userSaved = this.normalizeTracks(userSavedTracks);
    
    // For each position, find the best matching player
    for (const position of positions) {
      const positionPlayers = allPlayerSongs.filter(p => 
        p.position.toUpperCase() === position
      );
      
      if (positionPlayers.length === 0) {
        console.log(`No players found for position ${position}`);
        continue;
      }
      
      console.log(`Found ${positionPlayers.length} players for position ${position}`);
      
      // Calculate match scores for each player using multiple criteria
      const playersWithScores = positionPlayers.map(player => {
        const songMatch = this.findSongMatch(player.walkupSong, userTracks, userSaved);
        const artistMatch = this.findArtistMatch(player.walkupSong, userArtists);
        const genreMatch = this.calculateGenreMatchScore(userTopGenres, player.walkupSong.genre);
        
        // Combine scores with weights
        const matchScore = (
          songMatch.score * 0.5 +  // Direct song match is most important
          artistMatch.score * 0.3 + // Artist match is second most important
          genreMatch.matchScore * 0.2 // Genre match is least important
        );
        
        // Use the most specific match reason
        let matchReason = genreMatch.matchReason;
        if (songMatch.score > 0) {
          matchReason = `Top song`;
        } else if (artistMatch.score > 0) {
          matchReason = `Top artist`;
        }
        
        return { player, matchScore, matchReason };
      });
      
      // Log top 3 matches for debugging
      const topMatches = [...playersWithScores]
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 3);
      
      console.log(`Top 3 matches for ${position}:`);
      topMatches.forEach(match => {
        console.log(`- ${match.player.playerName}: ${match.matchScore.toFixed(2)} (${match.matchReason})`);
      });
      
      // Filter out players with low match scores
      const validMatches = playersWithScores.filter(p => p.matchScore >= this.MIN_MATCH_SCORE);
      
      if (validMatches.length === 0) {
        console.log(`No good matches found for position ${position}, using best available match`);
        // Use the best match even if below threshold
        const bestMatch = playersWithScores.sort((a, b) => b.matchScore - a.matchScore)[0];
        if (bestMatch) {
          team.push({
            ...bestMatch.player,
            matchReason: bestMatch.matchReason
          });
        }
        continue;
      }
      
      // Sort by match score (descending)
      validMatches.sort((a, b) => b.matchScore - a.matchScore);
      
      // Get the best matching player for this position
      const bestMatch = validMatches[0];
      console.log(`Best match for ${position}: ${bestMatch.player.playerName} (Score: ${bestMatch.matchScore.toFixed(2)})`);
      
      team.push({
        ...bestMatch.player,
        matchReason: bestMatch.matchReason
      });
    }
    
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
    walkupSong: { songName: string; artistName: string },
    userTracks: Array<{ name: string; artist: string }>,
    userSaved: Array<{ name: string; artist: string }>
  ): { score: number } {
    const normalizedSong = {
      name: walkupSong.songName.toLowerCase(),
      artist: walkupSong.artistName.toLowerCase()
    };
    
    // Check for exact matches
    const exactMatch = userTracks.some(track => 
      track.name === normalizedSong.name && track.artist === normalizedSong.artist
    );
    
    if (exactMatch) return { score: 1.0 };
    
    // Check for saved songs
    const savedMatch = userSaved.some(track => 
      track.name === normalizedSong.name && track.artist === normalizedSong.artist
    );
    
    if (savedMatch) return { score: 0.8 };
    
    // Check for partial matches (same song, different artist)
    const partialMatch = userTracks.some(track => track.name === normalizedSong.name);
    if (partialMatch) return { score: 0.6 };
    
    return { score: 0 };
  }
  
  /**
   * Find artist matches
   */
  private findArtistMatch(
    walkupSong: { artistName: string },
    userArtists: string[]
  ): { score: number } {
    const normalizedArtist = walkupSong.artistName.toLowerCase();
    
    // Check for exact artist match
    if (userArtists.includes(normalizedArtist)) {
      return { score: 1.0 };
    }
    
    // Check for partial artist name match
    const partialMatch = userArtists.some(artist => 
      artist.includes(normalizedArtist) || normalizedArtist.includes(artist)
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
}