export interface ApiPlayerListItem {
    id: number;
    fullName: string;
    position: {
        abbreviation: string;
    };
    team: {
        id: number;
        name: string;
    };
}

export interface ApiPlayerDetailResponse {
    id: number;
    fullName: string;
    position: {
        abbreviation: string;
    };
    team: {
        id: number;
        name: string;
    };
    stats: {
        batting: {
            avg: string;
            obp: string;
            slg: string;
            plateAppearances: number;
        };
        pitching: {
            era: string;
            inningsPitched: number;
        };
    };
    walkupSongs: WalkupSong[];
}

export interface WalkupSong {
    id: string;
    songName: string;
    artists: Array<{
        name: string;
        role?: string;
    }>;
    albumName: string;
    spotifyId?: string;
    youtubeId?: string;
    genre?: string[];
    albumArt?: string;
    previewUrl?: string;
} 