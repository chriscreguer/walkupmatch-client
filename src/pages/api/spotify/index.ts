import { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from 'next-auth/react';
import { SpotifyService } from '../../../services/spotify/spotifyService';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession({ req });
  
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const spotifyService = SpotifyService.fromSession(session);
  
  if (!spotifyService) {
    return res.status(400).json({ error: 'No Spotify access token available' });
  }
  
  try {
    switch (req.query.type) {
      case 'profile':
        const profile = await spotifyService.getUserProfile();
        return res.status(200).json(profile);
        
      case 'top-tracks':
        const timeRange = req.query.timeRange as 'short_term' | 'medium_term' | 'long_term' || 'medium_term';
        const limit = Number(req.query.limit) || 50;
        const tracks = await spotifyService.getTopTracks(limit, timeRange);
        return res.status(200).json(tracks);
        
      case 'top-artists':
        const artistTimeRange = req.query.timeRange as 'short_term' | 'medium_term' | 'long_term' || 'medium_term';
        const artistLimit = Number(req.query.limit) || 50;
        const artists = await spotifyService.getTopArtists(artistLimit, artistTimeRange);
        return res.status(200).json(artists);
        
      case 'genres':
        const genres = await spotifyService.getUserGenres();
        return res.status(200).json(genres);
        
      default:
        return res.status(400).json({ error: 'Invalid request type' });
    }
  } catch (error) {
    console.error('Spotify API error:', error);
    return res.status(500).json({ error: 'Failed to fetch data from Spotify' });
  }
}