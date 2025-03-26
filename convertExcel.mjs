import XLSX from 'xlsx';
import { promises as fs } from 'fs';
import * as path from 'path';

/**
 * Extracts player number and name from a string in the format "#<number> <Name>"
 */
function extractPlayerInfo(text) {
  const match = text.match(/^#(\d+)\s+(.*)$/);
  if (match) {
    return { number: match[1], name: match[2] };
  }
  return { number: '', name: text };
}

// Define available positions.
const positions = ["SP", "RP", "1B", "2B", "SS", "3B", "C", "DH", "LF", "RF", "CF"];
function getRandomPosition() {
  return positions[Math.floor(Math.random() * positions.length)];
}

async function convertExcel() {
  // Input file: original hierarchical Excel file
  const inputFilePath = path.join(process.cwd(), 'data', 'mlb_walkup_songs_2024.xlsx');
  // Output file: new flat-format Excel file
  const outputFilePath = path.join(process.cwd(), 'data', 'mlb_walkup_songs_flat.xlsx');
  
  try {
    const buffer = await fs.readFile(inputFilePath);
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let flatData = [];
    
    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      // Get rows as an array of arrays.
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
      
      if (rows.length < 3) continue; // Skip if there aren’t enough rows
      
      // Row 0: team name
      const currentTeam = rows[0][0].toString().trim();
      // We no longer use a position header; instead, assign random positions per player
      
      // Rows 2+ are player rows
      for (let i = 2; i < rows.length; i++) {
        const row = rows[i];
        // Ensure we have a non-empty first cell and it starts with "#"
        if (!row[0] || typeof row[0] !== 'string' || !row[0].startsWith('#')) continue;
        
        const playerInfo = extractPlayerInfo(row[0]);
        // Based on the debug output:
        // Column 2 (index 2) is the song and column 4 (index 4) is the artist.
        const song1 = row[2] ? row[2].toString().trim() : '';
        const artist1 = row[4] ? row[4].toString().trim() : '';
        
        flatData.push({
          Team: currentTeam,
          Position: getRandomPosition(),
          'Player Number': playerInfo.number,
          'Player Name': playerInfo.name,
          'Song 1': song1,
          'Artist 1': artist1,
          'Song 2': '',  // No data for song 2
          'Artist 2': '',
          'Song 3': '',  // No data for song 3
          'Artist 3': '',
        });
      }
    }
    
    // Create a new worksheet and workbook from the flat data
    const newWorksheet = XLSX.utils.json_to_sheet(flatData);
    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, newWorksheet, 'FlatData');
    XLSX.writeFile(newWorkbook, outputFilePath);
    
    console.log(`Flat Excel file generated at ${outputFilePath}`);
  } catch (err) {
    console.error("Error during conversion:", err);
  }
}

convertExcel();
