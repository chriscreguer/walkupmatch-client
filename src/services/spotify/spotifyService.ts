import SpotifyWebApi from 'spotify-web-api-node';
import { Session } from 'next-auth';

// Types for Spotify data
export interface SpotifyUserProfile {
  id: string;
  display_name: string | null;
  images: Array<{ url: string }>;
  followers: { total: number };
}

export interface SpotifyImage {
  url: string;
  height?: number;
  width?: number;
}

export interface SpotifyTopItem {
  id: string;
  name: string;
  type: 'track' | 'artist';
  images?: SpotifyImage[];
  album?: {
    images: SpotifyImage[];
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
  
  /**
   * Get the user's saved tracks
   */
  async getSavedTracks(limit = 50): Promise<SpotifyTopItem[]> {
    const response = await this.spotifyApi.getMySavedTracks({
      limit
    });
    
    return response.body.items.map(item => ({
      id: item.track.id,
      name: item.track.name,
      type: 'track',
      album: item.track.album,
      artists: item.track.artists,
      preview_url: item.track.preview_url
    })) as SpotifyTopItem[];
  }
  
  /**
   * Get track details from Spotify
   */
  async getTrackDetails(trackId: string): Promise<SpotifyTopItem | null> {
    try {
      const response = await this.spotifyApi.getTrack(trackId);
      return {
        id: response.body.id,
        name: response.body.name,
        type: 'track',
        album: response.body.album,
        artists: response.body.artists,
        preview_url: response.body.preview_url
      };
    } catch (error) {
      console.error('Error fetching track details:', error);
      return null;
    }
  }
  
  /**
   * Search for a track on Spotify
   */
  async searchTrack(songName: string, artistName: string): Promise<SpotifyTopItem | null> {
    try {
      const query = `${songName} artist:${artistName}`;
      const response = await this.spotifyApi.searchTracks(query, { limit: 1 });
      
      if (response.body.tracks && response.body.tracks.items?.length > 0) {
        const track = response.body.tracks.items[0];
        return {
          id: track.id,
          name: track.name,
          type: 'track',
          album: track.album,
          artists: track.artists,
          preview_url: track.preview_url
        };
      }
      return null;
    } catch (error) {
      console.error('Error searching track:', error);
      return null;
    }
  }
  
  /**
   * Get a default album art URL
   */
  getDefaultAlbumArt(): string {
    return 'https://i.scdn.co/image/ab67616d00001e02ff9ca10b55ce82ae553c8228';
  }

  /**
   * Get the best available album art URL from an array of images
   */
  getBestAlbumArtUrl(images: SpotifyImage[]): string {
    if (!images || images.length === 0) {
      return this.getDefaultAlbumArt();
    }
    
    // Try to find a 300x300 image first
    const mediumImage = images.find(img => img.height === 300 && img.width === 300);
    if (mediumImage) {
      return mediumImage.url;
    }
    
    // Fall back to the first image if no 300x300 is found
    return images[0].url;
  }

  /**
   * Get user's top tracks across all time frames
   */
  async getAllTopTracks(): Promise<{ short_term: SpotifyTopItem[], medium_term: SpotifyTopItem[], long_term: SpotifyTopItem[] }> {
    const [short_term, medium_term, long_term] = await Promise.all([
      this.getTopTracks(50, 'short_term'),
      this.getTopTracks(50, 'medium_term'),
      this.getTopTracks(50, 'long_term')
    ]);
    return { short_term, medium_term, long_term };
  }

  /**
   * Get user's top artists across all time frames
   */
  async getAllTopArtists(): Promise<{ short_term: SpotifyTopItem[], medium_term: SpotifyTopItem[], long_term: SpotifyTopItem[] }> {
    const [short_term, medium_term, long_term] = await Promise.all([
      this.getTopArtists(50, 'short_term'),
      this.getTopArtists(50, 'medium_term'),
      this.getTopArtists(50, 'long_term')
    ]);
    return { short_term, medium_term, long_term };
  }

  /**
   * Get user's saved tracks
   */
  async getSavedTracks(limit: number = 50): Promise<SpotifyTopItem[]> {
    const response = await this.spotifyApi.getMySavedTracks({
      limit
    });
    return response.body.items.map((item: any) => ({
      id: item.track.id,
      name: item.track.name,
      type: 'track',
      album: item.track.album,
      artists: item.track.artists,
      preview_url: item.track.preview_url
    }));
  }
}