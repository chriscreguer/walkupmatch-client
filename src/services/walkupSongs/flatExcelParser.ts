// src/lib/walkupSongs/flatExcelParser.ts
import * as XLSX from 'xlsx';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs/promises';
import { PlayerWalkupSong } from './types';

export class FlatExcelParser {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /**
   * Parse the flat Excel file format.
   */
  async parse(): Promise<PlayerWalkupSong[]> {
    try {
      // Read the Excel file from the given filePath
      const buffer = await fs.readFile(this.filePath);
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      // Assume one sheet with headers
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      // Convert sheet to JSON using header row keys
      const data = XLSX.utils.sheet_to_json<Record<string, any>>(worksheet, { defval: '' });

      const playerSongs: PlayerWalkupSong[] = [];

      for (const row of data) {
        // Extract values from each column
        const team: string = row['Team'];
        const position: string = row['Position'];
        const playerName: string = row['Player Name'];
        // You can use Player Number if needed: row['Player Number']

        // For each song/artist pair, if provided, create a record.
        if (row['Song 1'] && row['Artist 1']) {
          playerSongs.push(this.createPlayerSong(playerName, position, team, row['Song 1'], row['Artist 1']));
        }
        if (row['Song 2'] && row['Artist 2']) {
          playerSongs.push(this.createPlayerSong(playerName, position, team, row['Song 2'], row['Artist 2']));
        }
        if (row['Song 3'] && row['Artist 3']) {
          playerSongs.push(this.createPlayerSong(playerName, position, team, row['Song 3'], row['Artist 3']));
        }
      }

      return playerSongs;
    } catch (error) {
      console.error('Error parsing Excel file:', error);
      throw new Error(`Failed to parse walkup songs Excel file: ${(error as Error).message}`);
    }
  }

  /**
   * Helper to create a PlayerWalkupSong object.
   */
  private createPlayerSong(
    playerName: string,
    position: string,
    team: string,
    songName: string,
    artistName: string
  ): PlayerWalkupSong {
    return {
      playerId: uuidv4(),
      playerName,
      position, // Now directly coming from the file
      team,
      teamId: this.extractTeamId(team),
      walkupSong: {
        id: uuidv4(),
        songName,
        artistName,
        genre: this.inferGenreFromArtist(artistName)
      }
    };
  }

  /**
   * Extract team ID from team name.
   */
  private extractTeamId(teamName: string): string {
    const teamMap: Record<string, string> = {
      'Arizona Diamondbacks': 'AZ',
      'Atlanta Braves': 'ATL',
      'Baltimore Orioles': 'BAL',
      'Boston Red Sox': 'BOS',
      'Chicago Cubs': 'CHC',
      'Chicago White Sox': 'CWS',
      'Cincinnati Reds': 'CIN',
      'Cleveland Guardians': 'CLE',
      'Colorado Rockies': 'COL',
      'Detroit Tigers': 'DET',
      'Houston Astros': 'HOU',
      'Kansas City Royals': 'KC',
      'Los Angeles Angels': 'LAA',
      'Los Angeles Dodgers': 'LAD',
      'Miami Marlins': 'MIA',
      'Milwaukee Brewers': 'MIL',
      'Minnesota Twins': 'MIN',
      'New York Mets': 'NYM',
      'New York Yankees': 'NYY',
      'Oakland Athletics': 'OAK',
      'Philadelphia Phillies': 'PHI',
      'Pittsburgh Pirates': 'PIT',
      'San Diego Padres': 'SD',
      'San Francisco Giants': 'SF',
      'Seattle Mariners': 'SEA',
      'St. Louis Cardinals': 'STL',
      'Tampa Bay Rays': 'TB',
      'Texas Rangers': 'TEX',
      'Toronto Blue Jays': 'TOR',
      'Washington Nationals': 'WSH'
    };
    return teamMap[teamName] || teamName.slice(0, 3).toUpperCase();
  }

  /**
   * Infer genre from artist name (basic implementation).
   */
  private inferGenreFromArtist(artistName: string): string[] {
    const lower = artistName.toLowerCase();
    if (lower.includes('lil wayne') || lower.includes('drake') || lower.includes('meek mill') ||
        lower.includes('21 savage') || lower.includes('50 cent') || lower.includes('kanye') ||
        lower.includes('travis scott') || lower.includes('dmx')) {
      return ['rap', 'hip-hop'];
    }
    if (lower.includes('bad bunny') || lower.includes('don omar') ||
        lower.includes('j alvarez') || lower.includes('daddy yankee') ||
        lower.includes('gente de zona')) {
      return ['latin', 'reggaeton'];
    }
    if (lower.includes('van halen') || lower.includes('rage against') ||
        lower.includes('rise against')) {
      return ['rock', 'hard rock'];
    }
    if (lower.includes('tiesto') || lower.includes('avicii')) {
      return ['electronic', 'edm'];
    }
    if (lower.includes('florida georgia') || lower.includes('chris young')) {
      return ['country'];
    }
    return ['unknown'];
  }
}
