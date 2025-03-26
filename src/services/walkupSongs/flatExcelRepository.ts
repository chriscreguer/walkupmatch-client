// src/lib/walkupSongs/flatExcelRepository.ts
import { PlayerWalkupSong, WalkupSongRepository } from '../../lib/walkupSongs/types';
import { FlatExcelParser } from './flatExcelParser'

export class FlatExcelRepository implements WalkupSongRepository {
  private filePath: string;
  private cachedData: PlayerWalkupSong[] | null = null;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Load and cache all data from the Excel file.
   */
  private async loadData(): Promise<PlayerWalkupSong[]> {
    if (this.cachedData) return this.cachedData;
    try {
      const parser = new FlatExcelParser(this.filePath);
      this.cachedData = await parser.parse();
      return this.cachedData;
    } catch (error) {
      console.error('Error loading walkup song data:', error);
      return [];
    }
  }

  async getAllPlayerSongs(): Promise<PlayerWalkupSong[]> {
    return await this.loadData();
  }
  
  // Implement other methods as needed...
  async getPlayerSongsByTeam(teamId: string): Promise<PlayerWalkupSong[]> {
    const allData = await this.loadData();
    return allData.filter(player => player.teamId.toLowerCase() === teamId.toLowerCase());
  }

  async getPlayerSongsByPosition(position: string): Promise<PlayerWalkupSong[]> {
    const allData = await this.loadData();
    return allData.filter(player => player.position.toLowerCase() === position.toLowerCase());
  }

  async getPlayerSongById(playerId: string): Promise<PlayerWalkupSong | null> {
    const allData = await this.loadData();
    return allData.find(player => player.playerId === playerId) || null;
  }

  async getPlayerSongsByGenre(genre: string): Promise<PlayerWalkupSong[]> {
    const allData = await this.loadData();
    return allData.filter(player => 
      player.walkupSong.genre.some(g => 
        g.toLowerCase().includes(genre.toLowerCase()) || 
        genre.toLowerCase().includes(g.toLowerCase())
      )
    );
  }
}
