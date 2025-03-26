import SpotifyWebApi from 'spotify-web-api-node';
import { Session } from 'next-auth';

// Types for Spotify data
export interface SpotifyUserProfile {
  id: string;
  display_name: string | null;
  images: Array<{ url: string }>;
  followers: { total: number };
}

export interface SpotifyTopItem {
  id: string;
  name: string;
  type: 'track' | 'artist';
  images?: Array<{ url: string }>;
  album?: {
    images: Array<{ url: string }>;
  };
  artists?: Array<{
    id: string;
    name: string;
  }>;
  preview_url?: string | null;
  genres?: string[];
}

export interface SpotifyGenreSummary {
  name: string;
  count: number;
  weight: number;
}

/**
 * Service class for interacting with Spotify API
 */
export class SpotifyService {
  private spotifyApi: SpotifyWebApi;
  
  constructor(accessToken: string) {
    this.spotifyApi = new SpotifyWebApi({
      clientId: process.env.SPOTIFY_CLIENT_ID,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
    });
    
    this.spotifyApi.setAccessToken(accessToken);
  }
  
  /**
   * Create a SpotifyService instance from a NextAuth session
   */
  static fromSession(session: Session | null): SpotifyService | null {
    if (!session?.accessToken) return null;
    return new SpotifyService(session.accessToken as string);
  }
  
  /**
   * Get the current user's Spotify profile
   */
  async getUserProfile(): Promise<SpotifyUserProfile> {
    const response = await this.spotifyApi.getMe();
    return response.body as SpotifyUserProfile;
  }
  
  /**
   * Get the user's top tracks
   */
  async getTopTracks(limit = 50, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term'): Promise<SpotifyTopItem[]> {
    const response = await this.spotifyApi.getMyTopTracks({
      limit,
      time_range: timeRange
    });
    
    return response.body.items.map(track => ({
      id: track.id,
      name: track.name,
      type: 'track',
      album: track.album,
      artists: track.artists,
      preview_url: track.preview_url
    })) as SpotifyTopItem[];
  }
  
  /**
   * Get the user's top artists
   */
  async getTopArtists(limit = 50, timeRange: 'short_term' | 'medium_term' | 'long_term' = 'medium_term'): Promise<SpotifyTopItem[]> {
    const response = await this.spotifyApi.getMyTopArtists({
      limit,
      time_range: timeRange
    });
    
    return response.body.items.map(artist => ({
      id: artist.id,
      name: artist.name,
      type: 'artist',
      images: artist.images,
      genres: artist.genres
    })) as SpotifyTopItem[];
  }
  
  /**
   * Extract genres from user's top artists and calculate weight
   */
  async getUserGenres(): Promise<SpotifyGenreSummary[]> {
    const topArtists = await this.getTopArtists();
    const genreMap = new Map<string, number>();
    
    // Count occurrences of each genre
    topArtists.forEach(artist => {
      artist.genres?.forEach(genre => {
        genreMap.set(genre, (genreMap.get(genre) || 0) + 1);
      });
    });
    
    // Convert to array and calculate weights
    const totalArtists = topArtists.length;
    const genres = Array.from(genreMap.entries()).map(([name, count]) => ({
      name,
      count,
      weight: count / totalArtists
    }));
    
    // Sort by count (descending)
    return genres.sort((a, b) => b.count - a.count);
  }
  
  /**
   * Create a playlist in the user's account
   */
  async createPlaylist(name: string, description: string): Promise<{ id: string; url: string }> {
    const user = await this.getUserProfile();
    
    const response = await this.spotifyApi.createPlaylist(user.id, {
      name,
      description,
      public: false
    } as { name: string; description: string; public: boolean });
    
    return {
      id: response.body.id,
      url: response.body.external_urls.spotify
    };
  }
  
  /**
   * Add tracks to a playlist
   */
  async addTracksToPlaylist(playlistId: string, trackUris: string[]): Promise<void> {
    await this.spotifyApi.addTracksToPlaylist(playlistId, trackUris);
  }
}