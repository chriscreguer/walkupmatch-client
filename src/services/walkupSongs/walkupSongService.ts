import { PlayerWalkupSong, WalkupSongRepository } from '@/lib/walkupSongs/types';
import { SpotifyGenreSummary, SpotifyTopItem } from '@/services/spotify/spotifyService';
import { Position } from '@/lib/mlb/types';

/**
 * Service for matching user music preferences with walkup songs
 */
export class WalkupSongService {
  private repository: WalkupSongRepository;
  private readonly MIN_MATCH_SCORE = 0.1;
  private usedSongs: Set<string> = new Set();
  private usedArtists: Map<string, number> = new Map();
  
  constructor(repository: WalkupSongRepository) {
    this.repository = repository;
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
    const allPlayerSongs = await this.repository.getAllPlayerSongs();
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
    
    // For each position, find the best matching player
    for (const position of positions) {
      // Special handling for relief pitchers
      if (position === 'RP') {
        // Find all relief pitchers and sort by match score
        const reliefPitchers = allPlayerSongs.filter(p => 
          p.position === 'RP' && !this.usedSongs.has(p.walkupSong.songName)
        );
        
        if (reliefPitchers.length > 0) {
          // Calculate match scores for each relief pitcher
          const pitchersWithScores = reliefPitchers.map(player => {
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
          
          // Sort by match score and take top 5
          const topPitchers = pitchersWithScores
            .sort((a, b) => b.matchScore - a.matchScore)
            .slice(0, 5);
          
          // Add each pitcher to the team with their position adjusted
          topPitchers.forEach((pitcher, index) => {
            const position = index === 0 ? 'RP' : `RP${index + 1}`;
            this.usedSongs.add(pitcher.player.walkupSong.songName);
            this.incrementArtistCount(pitcher.player.walkupSong.artistName);
            team.push({
              ...pitcher.player,
              position,
              matchReason: pitcher.matchReason,
              rankInfo: pitcher.rankInfo,
              matchScore: pitcher.matchScore
            });
          });
          
          continue;
        }
      }
      
      // Regular position handling (non-RP)
      const positionPlayers = allPlayerSongs.filter(p => 
        p.position.toUpperCase() === position && !this.usedSongs.has(p.walkupSong.songName)
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
        
        // Combine scores with weights, prioritizing top song matches
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
      
      // Log top 3 matches for debugging
      const topMatches = [...playersWithScores]
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, 3);
      
      console.log(`Top 3 matches for ${position}:`);
      topMatches.forEach(match => {
        console.log(`- ${match.player.playerName}: ${match.matchScore.toFixed(2)} (${match.matchReason} ${match.rankInfo})`);
      });
      
      // Filter out players with low match scores
      const validMatches = playersWithScores.filter(p => p.matchScore >= this.MIN_MATCH_SCORE);
      
      if (validMatches.length === 0) {
        console.log(`No good matches found for position ${position}, using best available match`);
        // Use the best match even if below threshold
        const bestMatch = playersWithScores.sort((a, b) => b.matchScore - a.matchScore)[0];
        if (bestMatch) {
          this.usedSongs.add(bestMatch.player.walkupSong.songName);
          this.incrementArtistCount(bestMatch.player.walkupSong.artistName);
          team.push({
            ...bestMatch.player,
            matchReason: bestMatch.matchReason,
            rankInfo: bestMatch.rankInfo
          });
        }
        continue;
      }
      
      // Sort by match score (descending)
      validMatches.sort((a, b) => b.matchScore - a.matchScore);
      
      // Get the best matching player for this position
      const bestMatch = validMatches[0];
      console.log(`Best match for ${position}: ${bestMatch.player.playerName} (Score: ${bestMatch.matchScore.toFixed(2)})`);
      
      this.usedSongs.add(bestMatch.player.walkupSong.songName);
      this.incrementArtistCount(bestMatch.player.walkupSong.artistName);
      team.push({
        ...bestMatch.player,
        matchReason: bestMatch.matchReason,
        rankInfo: bestMatch.rankInfo
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
    userTracks: { short_term: Array<{ name: string; artist: string }>, medium_term: Array<{ name: string; artist: string }>, long_term: Array<{ name: string; artist: string }> },
    userSaved: Array<{ name: string; artist: string }>
  ): { score: number; rank?: number; rankBonus?: number; timeFrame?: 'short_term' | 'medium_term' | 'long_term' } {
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
    walkupSong: { artistName: string },
    userArtists: { short_term: string[], medium_term: string[], long_term: string[] }
  ): { score: number; rank?: number; timeFrame?: 'short_term' | 'medium_term' | 'long_term' } {
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