// src/config/matchingConfig.ts

export const MIN_MATCH_SCORE = 0.1; // Minimum score for a player to be considered
export const SECONDARY_SONG_THRESHOLD = 1; // Threshold for considering secondary songs (if logic changes)
export const MULTIPLE_SONG_BONUS = 0.03; // Base bonus for players with multiple matching songs

// Weights for different aspects of the match score
export const SCORE_WEIGHTS = {
    TIME_FRAME: { // Bonus based on how recent the user listened
        'long_term': 0.05,
        'medium_term': 0.03,
        'short_term': 0.01
    },
    RANK: { // Bonus based on rank within top 50
        TOP_10: 0.2,
        TOP_25: 0.1,
        TOP_50: 0
    },
    ARTIST_RANK_BONUS: { // Specific bonuses based on artist rank per timeframe
        SHORT_TERM: [
            { threshold: 5, bonus: 0.20 },
            { threshold: 15, bonus: 0.10 },
            { threshold: 30, bonus: 0.0 },
        ],
        MEDIUM_TERM: [
            { threshold: 10, bonus: 0.2 },
            { threshold: 25, bonus: 0.1 },
            { threshold: 50, bonus: 0.0 },
        ],
        LONG_TERM: [
            { threshold: 10, bonus: 0.2 },
            { threshold: 25, bonus: 0.1 },
            { threshold: 50, bonus: 0.0 },
        ]
    },
    MATCH_TYPE: { // Base score multiplier/adder for different match types
        LIKED_SONG: 1.4, // Direct match in user's liked songs (via API check)
        TOP_SONG: 1.5, // Direct match in user's top tracks
        TOP_ARTIST: 0.8, // Artist of song is in user's top artists
        FEATURE: 0.6, // Featured artist on song is in user's top artists
        GENRE: 0.4 // Genre match score multiplier
    },
    ARTIST_DIVERSITY_PENALTY: { // Score reduction multiplier for subsequent picks of the same artist
        FIRST: 0.0, // No penalty
        SECOND: 0.4, // 40% score reduction
        THIRD: 0.6, // 60% score reduction
        FOURTH: 0.7, // 70% score reduction
        FIFTH_PLUS: 0.8 // 80% score reduction
    },
    MULTIPLE_MATCHES_BONUS: 0.03, // Additive bonus if multiple songs/artists/genres match
    GENRE_ARTIST_LIKED_BONUS: 0.05, // Bonus to genre score if user likes the artist
    EXACT_GENRE_MATCH_BONUS: 0.05, // Bonus to genre score for exact string match
    SAVED_ALBUM_BONUS: 0.02 // Bonus if user saved the album (currently unused, needs implementation)
};

// Position compatibility matrices (DH handled separately in logic)
export const COMPATIBLE_POSITIONS: Record<string, string[]> = {
    'C': [], '1B': [], '2B': ['SS'], '3B': [], 'SS': ['2B'], 'OF': [], 'P': []
    // Add LF, CF, RF if specific OF logic is needed, currently handled by 'OF' check
};
export const SIMILAR_POSITIONS: Record<string, string[]> = {
    'C': [], '1B': [], '2B': ['3B'], '3B': ['SS', '2B'], 'SS': ['3B'], 'OF': [], 'P': []
    // Add LF, CF, RF if specific OF logic is needed
};
export const FALLBACK_POSITIONS: Record<string, string[]> = {
    // Primarily for DH, defining infielders/catchers as fallback
    'DH': ['1B', '2B', '3B', 'C', 'SS', 'OF'] // Added OF here as potential fallback
};

// Position weights (if needed for scoring adjustments based on flexibility)
export const POSITION_WEIGHTS: Record<string, number> = {
    'EXACT': 1.0,
    'SIMILAR': 0.8,
    'COMPATIBLE': 0.6,
    'FALLBACK': 0.4
};

// Diversity Boost Configuration
export const DIVERSITY_THRESHOLD = 2; // Max players desired per top genre before boost stops
export const DIVERSITY_BOOST_AMOUNT = 0.075; // The score boost amount
export const NUM_USER_TOP_GENRES = 5; // Consider top N genres for diversity boost

// Player Stat Validation Configuration
export const MIN_GAMES_PLAYED_THRESHOLD = 10; // Minimum games played for a player to be considered valid
export const HITTER_PA_PER_GAME_THRESHOLD = 1.0; // Min Plate Appearances per Team Game Played
export const PITCHER_IP_PER_GAME_THRESHOLD = 0.4; // Min Innings Pitched per Team Game Played