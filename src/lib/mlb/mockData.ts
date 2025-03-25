import { MLBPlayer } from './types';

export const mockPlayers: MLBPlayer[] = [
  {
    id: '1',
    name: 'Mike Trout',
    firstName: 'Mike',
    lastName: 'Trout',
    position: 'CF',
    team: 'LAA',
    teamLogo: '/images/teams/laa.png',
    imageUrl: '/images/players/mike_trout.png',
    stats: {
      avg: 0.312,
      ops: 1.019,
      runs: 87,
      plateAppearances: 424,
    },
    walkupSong: {
      title: 'Sicko Mode',
      artist: 'Travis Scott',
      spotifyId: '2xLMifQCjDGFmkHkpNLD9h',
    },
  },
  // Add more mock players for each position
  // SP, RP, C, 1B, 2B, 3B, SS, LF, CF, RF, DH
]