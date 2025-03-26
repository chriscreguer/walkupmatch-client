import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { WalkupSongFactory } from '@/services/walkupSongs/walkupSongFactory';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession({ req });
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const repository = WalkupSongFactory.createRepository();
    
    switch (req.query.type) {
      case 'all':
        const allSongs = await repository.getAllPlayerSongs();
        return res.status(200).json(allSongs);
        
      case 'team':
        const teamId = req.query.teamId as string;
        if (!teamId) {
          return res.status(400).json({ error: 'Team ID is required' });
        }
        const teamSongs = await repository.getPlayerSongsByTeam(teamId);
        return res.status(200).json(teamSongs);
        
      case 'position':
        const position = req.query.position as string;
        if (!position) {
          return res.status(400).json({ error: 'Position is required' });
        }
        const positionSongs = await repository.getPlayerSongsByPosition(position);
        return res.status(200).json(positionSongs);
        
      case 'player':
        const playerId = req.query.playerId as string;
        if (!playerId) {
          return res.status(400).json({ error: 'Player ID is required' });
        }
        const playerSong = await repository.getPlayerSongById(playerId);
        if (!playerSong) {
          return res.status(404).json({ error: 'Player not found' });
        }
        return res.status(200).json(playerSong);
        
      case 'genre':
        const genre = req.query.genre as string;
        if (!genre) {
          return res.status(400).json({ error: 'Genre is required' });
        }
        const genreSongs = await repository.getPlayerSongsByGenre(genre);
        return res.status(200).json(genreSongs);
        
      default:
        return res.status(400).json({ error: 'Invalid request type' });
    }
  } catch (error) {
    console.error('Walkup songs API error:', error);
    return res.status(500).json({ error: 'Failed to fetch walkup song data' });
  }
}