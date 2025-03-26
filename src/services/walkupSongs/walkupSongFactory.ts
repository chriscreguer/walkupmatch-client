// src/services/walkupSongs/walkupSongFactory.ts
import path from 'path';
import { WalkupSongRepository } from '@/lib/walkupSongs/types';
import { FlatExcelRepository } from './flatExcelRepository';
import { WalkupSongService } from './walkupSongService';

// Update the path to point to your file in the root data/ folder.
const dataDir = path.join(process.cwd(), 'data');
const excelFilePath = path.join(dataDir, 'mlb_walkup_songs_flat.xlsx');

export class WalkupSongFactory {
  static createRepository(): WalkupSongRepository {
    return new FlatExcelRepository(excelFilePath);
  }
  
  static createService(): WalkupSongService {
    const repository = this.createRepository();
    return new WalkupSongService(repository);
  }
}
