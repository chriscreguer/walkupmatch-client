// src/services/walkupDb/walkupDbClient.ts
import axios from 'axios';

// Interface matching the expected structure from the /players endpoint list item
interface ApiPlayerListItem {
    id: string; // Assuming the list provides the ID
    // Add other fields if the list provides more than just ID
    name?: string;
}

// Interface matching the expected structure from the /players/{id} endpoint
interface ApiPlayerDetailSong {
    id: string;
    title: string;
    artists: string[];
    spotify_id?: string;
    spotify_image?: string;
    // Add other potential song fields from the API
}

interface ApiPlayerDetailData {
    id: string;
    name: string;
    mlb_id: string; // Assuming API provides this
    position: string; // Assuming API provides this
    team: {
        name: string;
        id: string; // Assuming API provides team ID/abbreviation
    };
    songs: ApiPlayerDetailSong[];
}

export interface ApiPlayerDetailResponse {
    data: ApiPlayerDetailData;
}


export class WalkupDbClient {
    private static instance: WalkupDbClient;
    private readonly API_BASE_URL = 'https://walkupdb.com/api';
    private readonly RATE_LIMIT_DELAY = 1000; // Milliseconds between requests to walkupdb.com
    private lastRequestTime = 0;

    private constructor() { }

    public static getInstance(): WalkupDbClient {
        if (!WalkupDbClient.instance) {
            WalkupDbClient.instance = new WalkupDbClient();
        }
        return WalkupDbClient.instance;
    }

    private async delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async waitForRateLimit(): Promise<void> {
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.RATE_LIMIT_DELAY) {
            const waitTime = this.RATE_LIMIT_DELAY - timeSinceLastRequest;
            // console.log(`WalkupDbClient: Waiting ${waitTime}ms...`); // Optional logging
            await this.delay(waitTime);
        }
        this.lastRequestTime = Date.now();
    }

    /**
     * Fetches the complete list of players from the WalkupDB API, handling pagination.
     * @returns {Promise<ApiPlayerListItem[]>} A promise resolving to an array of player list items.
     */
    async fetchAllPlayers(): Promise<ApiPlayerListItem[]> {
        const allPlayers: ApiPlayerListItem[] = [];
        let page = 1;
        let hasMore = true;
        let retryCount = 0;
        const MAX_RETRIES = 5;
        const BASE_RETRY_DELAY = 2000; // Start retry delay at 2 seconds

        console.log('WalkupDbClient: Starting fetch all players...');

        while (hasMore) {
            await this.waitForRateLimit();
            try {
                console.log(`WalkupDbClient: Fetching page ${page}...`);
                const response = await axios.get<{
                    data: ApiPlayerListItem[],
                    links?: { next?: string | null },
                    meta?: { current_page: number; last_page: number }
                }>(`${this.API_BASE_URL}/players`, { params: { page } });

                console.log(`WalkupDbClient: Page ${page} status ${response.status}`);

                if (response.data && response.data.data && response.data.data.length > 0) {
                    allPlayers.push(...response.data.data);
                    console.log(`WalkupDbClient: Added ${response.data.data.length} players. Total: ${allPlayers.length}`);
                    // Determine if there are more pages based on API response structure
                    hasMore = response.data.links?.next !== null && response.data.links?.next !== undefined;
                     if (response.data.meta && response.data.meta.current_page >= response.data.meta.last_page) {
                         hasMore = false; // Stop if meta indicates last page
                     }
                    if (hasMore) {
                         page++;
                    }
                    retryCount = 0; // Reset retries on success
                } else {
                    console.log(`WalkupDbClient: No more players found on page ${page} or empty data array.`);
                    hasMore = false;
                }
            } catch (error) {
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    const retryAfterHeader = error.response?.headers['retry-after'];
                    console.error(`WalkupDbClient: Error fetching page ${page} - Status ${status}`, error.message);

                    if (status === 429 || status === 503) { // Handle Rate Limiting or Service Unavailable
                         if (retryCount < MAX_RETRIES) {
                              retryCount++;
                              const retryAfterSeconds = parseInt(retryAfterHeader || '0', 10);
                              const delayTime = Math.max(retryAfterSeconds * 1000, BASE_RETRY_DELAY * Math.pow(2, retryCount -1));
                              console.log(`WalkupDbClient: Attempt ${retryCount}/${MAX_RETRIES}. Rate limited or service unavailable. Retrying after ${delayTime / 1000} seconds...`);
                              await this.delay(delayTime);
                              // Continue loop to retry the same page
                         } else {
                              console.error(`WalkupDbClient: Max retries (${MAX_RETRIES}) reached for page ${page}. Stopping fetch.`);
                              hasMore = false; // Stop fetching
                              throw new Error(`WalkupDbClient: Max retries reached while fetching player list. Last error: ${error.message}`);
                         }
                    } else {
                         // For other errors, log and stop
                         console.error(`WalkupDbClient: Unrecoverable error fetching page ${page}. Stopping fetch.`);
                         hasMore = false;
                         throw error; // Re-throw other errors
                    }
                } else {
                    console.error(`WalkupDbClient: Non-Axios error fetching page ${page}. Stopping fetch.`, error);
                    hasMore = false;
                    throw error; // Re-throw non-axios errors
                }
            }
        } // End while loop

        console.log(`WalkupDbClient: Finished fetching all players. Total: ${allPlayers.length}`);
        return allPlayers;
    }


    /**
     * Fetches detailed information for a single player.
     * @param {string} playerId The ID of the player to fetch.
     * @returns {Promise<ApiPlayerDetailResponse | null>} A promise resolving to the player details or null if not found/error.
     */
    async fetchPlayerDetails(playerId: string): Promise<ApiPlayerDetailResponse | null> {
        if (!playerId) {
            console.warn('WalkupDbClient: fetchPlayerDetails called with invalid playerId.');
            return null;
        }
        await this.waitForRateLimit();
        try {
            // console.log(`WalkupDbClient: Fetching details for player ${playerId}...`); // Optional logging
            const response = await axios.get<ApiPlayerDetailResponse>(`${this.API_BASE_URL}/players/${playerId}`);
            // console.log(`WalkupDbClient: Status ${response.status} for player ${playerId}`); // Optional logging
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 404) {
                console.warn(`WalkupDbClient: Player ${playerId} not found (404).`);
            } else {
                console.error(`WalkupDbClient: Error fetching details for player ${playerId}:`, error instanceof Error ? error.message : error);
            }
            return null;
        }
    }
}