export interface PlayerStats {
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
}

export interface WalkupSong {
    id: string;
    songName: string;
    artists: Array<{ name: string; role: 'primary' | 'featured' | 'producer' }>;
    albumName: string;
    spotifyId: string;
    youtubeId: string;
    genre: string[];
    albumArt: string;
    previewUrl: string | null;
}

export interface PlayerWalkupSong {
    playerId: string;
    playerName: string;
    position: string;
    team: string;
    teamId: string;
    walkupSongs: WalkupSong[];
    stats: PlayerStats;
    walkupSong: WalkupSong;
} 