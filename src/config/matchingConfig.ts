// src/config/matchingConfig.ts

// Minimum score for a player to be considered
export const MIN_MATCH_SCORE = 0.1;
// Bonus for players with multiple matching songs (Applied within song scoring logic)
export const MULTIPLE_MATCHES_BONUS = 0.03;
// Score weights for different aspects of the match
export const SCORE_WEIGHTS = {
    TIME_FRAME: {
        'long_term': 0.05,
        'medium_term': 0.03,
        'short_term': 0.01
    },
    RANK: {
        TOP_10: 0.2,
        TOP_25: 0.1,
        TOP_50: 0
    },
    ARTIST_RANK_BONUS: {
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
    MATCH_TYPE: {
        LIKED_SONG: 1.55, // Boosted to prioritize liked songs
        TOP_SONG: 1.5,
        TOP_ARTIST: 0.9, // Slightly boosted for better visibility
        FEATURE: 0.6,
        GENRE: 0.4
    },
    ARTIST_DIVERSITY_PENALTY: {
        FIRST: 0.0,    // 0%
        SECOND: 0.4,   // 40% reduction
        THIRD: 0.6,    // 60% reduction
        FOURTH: 0.7,   // 70% reduction
        FIFTH_PLUS: 0.8 // 80% reduction
    },
    MULTIPLE_MATCHES_BONUS: 0.03, // Base bonus used in scoring logic
    GENRE_ARTIST_LIKED_BONUS: 0.05, // Bonus if artist of genre match is liked/top
    EXACT_GENRE_MATCH_BONUS: 0.05, // Bonus for exact genre string match
    SAVED_ALBUM_BONUS: 0.02 // Bonus if user saved the album (if implemented)
};

// Position compatibility (DH handled separately)
export const COMPATIBLE_POSITIONS: Record<string, string[]> = {
    'C': [], '1B': [], '2B': ['SS'], '3B': [], 'SS': ['2B'], 'OF': [], 'P': []
};
export const SIMILAR_POSITIONS: Record<string, string[]> = {
    'C': [], '1B': [], '2B': ['3B'], '3B': ['SS', '2B'], 'SS': ['3B'], 'OF': [], 'P': []
};
export const FALLBACK_POSITIONS: Record<string, string[]> = {
    'DH': ['1B', '2B', '3B', 'C', 'SS', 'OF', 'LF', 'CF', 'RF'] // Allow any non-pitcher essentially
};

// Position weights (if needed for scoring adjustments)
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
export const MIN_GAMES_PLAYED_THRESHOLD = 10; // Minimum team games played for validation
export const HITTER_PA_PER_GAME_THRESHOLD = 1.0; // Min Plate Appearances per Team Game Played
export const PITCHER_IP_PER_GAME_THRESHOLD = 0.4; // Min Innings Pitched per Team Game Played