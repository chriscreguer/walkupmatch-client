import { Player, Position, TeamStats } from './types';

/**
 * Generate mock MLB players data grouped by position
 */
export function getMockPlayersByPosition(): Record<Position, Player[]> {
  return {
    'SP': [
      {
        id: 'SP-1',
        name: 'Justin Verlander',
        firstName: 'Justin',
        lastName: 'Verlander',
        position: 'SP',
        team: 'Houston Astros',
        teamAbbreviation: 'HOU',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      },
      {
        id: 'SP-2',
        name: 'Max Scherzer',
        firstName: 'Max',
        lastName: 'Scherzer',
        position: 'SP',
        team: 'New York Mets',
        teamAbbreviation: 'NYM',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    'CP': [
      {
        id: 'CP-1',
        name: 'Josh Hader',
        firstName: 'Josh',
        lastName: 'Hader',
        position: 'CP',
        team: 'San Diego Padres',
        teamAbbreviation: 'SD',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    'C': [
      {
        id: 'C-1',
        name: 'J.T. Realmuto',
        firstName: 'J.T.',
        lastName: 'Realmuto',
        position: 'C',
        team: 'Philadelphia Phillies',
        teamAbbreviation: 'PHI',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    '1B': [
      {
        id: '1B-1',
        name: 'Freddie Freeman',
        firstName: 'Freddie',
        lastName: 'Freeman',
        position: '1B',
        team: 'Los Angeles Dodgers',
        teamAbbreviation: 'LAD',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    '2B': [
      {
        id: '2B-1',
        name: 'Jose Altuve',
        firstName: 'Jose',
        lastName: 'Altuve',
        position: '2B',
        team: 'Houston Astros',
        teamAbbreviation: 'HOU',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    '3B': [
      {
        id: '3B-1',
        name: 'Nolan Arenado',
        firstName: 'Nolan',
        lastName: 'Arenado',
        position: '3B',
        team: 'St. Louis Cardinals',
        teamAbbreviation: 'STL',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    'SS': [
      {
        id: 'SS-1',
        name: 'Carlos Correa',
        firstName: 'Carlos',
        lastName: 'Correa',
        position: 'SS',
        team: 'Minnesota Twins',
        teamAbbreviation: 'MIN',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    'LF': [
      {
        id: 'LF-1',
        name: 'Juan Soto',
        firstName: 'Juan',
        lastName: 'Soto',
        position: 'LF',
        team: 'San Diego Padres',
        teamAbbreviation: 'SD',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    'CF': [
      {
        id: 'CF-1',
        name: 'Mike Trout',
        firstName: 'Mike',
        lastName: 'Trout',
        position: 'CF',
        team: 'Los Angeles Angels',
        teamAbbreviation: 'LAA',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    'RF': [
      {
        id: 'RF-1',
        name: 'Aaron Judge',
        firstName: 'Aaron',
        lastName: 'Judge',
        position: 'RF',
        team: 'New York Yankees',
        teamAbbreviation: 'NYY',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    'DH': [
      {
        id: 'DH-1',
        name: 'Shohei Ohtani',
        firstName: 'Shohei',
        lastName: 'Ohtani',
        position: 'DH',
        team: 'Los Angeles Angels',
        teamAbbreviation: 'LAA',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ],
    'RP': [
      {
        id: 'RP-1',
        name: 'Edwin Diaz',
        firstName: 'Edwin',
        lastName: 'Diaz',
        position: 'RP',
        team: 'New York Mets',
        teamAbbreviation: 'NYM',
        headshot: 'https://via.placeholder.com/32',
        stats: {}
      }
    ]
  };
}

/**
 * Calculate stats for a team of players
 */
export function calculateTeamStats(players: Player[]): TeamStats {
  // These would normally be calculated from actual player stats
  // For now, using mock data
  return {
    wins: 55,
    losses: 35,
    OPS: 0.782,
    AVG: 0.267,
    ERA: 3.42
  };
}