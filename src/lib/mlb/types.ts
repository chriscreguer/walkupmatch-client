export interface MLBPlayer {
    id: string;
    name: string;
    firstName: string;
    lastName: string;
    position: string;
    team: string;
    teamLogo: string;
    imageUrl: string;
    stats: PlayerStats;
    walkupSong?: WalkupSong;
  }
  
  export interface WalkupSong {
    title: string;
    artist: string;
    spotifyId?: string;
    audioFeatures?: SpotifyAudioFeatures;
  }
  
  export interface PlayerStats {
    // Batting stats
    avg?: number; // Batting average
    ops?: number; // On-base plus slugging
    runs?: number;
    plateAppearances?: number;
    
    // Pitching stats
    era?: number; // Earned run average
    inningsPitched?: number;
    runsAllowed?: number;
  }
  
  export interface SpotifyAudioFeatures {
    danceability: number;
    energy: number;
    key: number;
    loudness: number;
    mode: number;
    speechiness: number;
    acousticness: number;
    instrumentalness: number;
    liveness: number;
    valence: number;
    tempo: number;
  }