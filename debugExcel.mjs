import XLSX from 'xlsx';
import { promises as fs } from 'fs';
import * as path from 'path';

async function debugExcel() {
  const filePath = path.join(process.cwd(), 'data', 'mlb_walkup_songs_2024.xlsx');
  const buffer = await fs.readFile(filePath);
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  
  for (const sheetName of workbook.SheetNames) {
    const worksheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    console.log(`Sheet: ${sheetName}`);
    console.log(rows.slice(0, 10)); // Log first 10 rows
  }
}

debugExcel().catch(err => console.error(err));
