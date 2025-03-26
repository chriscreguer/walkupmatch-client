import React from 'react';
import Image from 'next/image';
import { Player } from '@/lib/mlb/types';

interface BaseballDiamondProps {
  players: Player[];
  loading?: boolean;
}

// Simple hard-coded positions for each role on the field
const POSITIONS: Record<string, { x: number, y: number }> = {
  'SP': { x: 150, y: 150 }, // Pitcher's mound
  'C': { x: 150, y: 250 },  // Catcher
  '1B': { x: 220, y: 180 }, // First base
  '2B': { x: 180, y: 120 }, // Second base
  '3B': { x: 80, y: 180 },  // Third base
  'SS': { x: 120, y: 120 }, // Shortstop
  'LF': { x: 50, y: 80 },   // Left field
  'CF': { x: 150, y: 50 },  // Center field
  'RF': { x: 250, y: 80 },  // Right field
  'DH': { x: 230, y: 250 }, // Designated hitter (near dugout)
  'RP': { x: 70, y: 250 },  // Relief pitcher (in bullpen)
};

// Helper to find a player by position
const findPlayerByPosition = (players: Player[], position: string): Player | undefined => {
  return players.find(player => player.position === position);
};

const BaseballDiamond: React.FC<BaseballDiamondProps> = ({ players, loading = false }) => {
  if (loading) {
    return (
      <div className="h-80 flex items-center justify-center">
        <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-green-500"></div>
      </div>
    );
  }

  return (
    <div className="relative h-80 w-full">
      {/* Base diamond shape */}
      <svg className="absolute inset-0 w-full h-full" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
        {/* Outfield grass */}
        <circle cx="150" cy="150" r="120" fill="#95BB72" fillOpacity="0.5" />
        
        {/* Infield dirt */}
        <circle cx="150" cy="150" r="70" fill="#D4A76A" fillOpacity="0.7" />
        
        {/* Diamond shapes */}
        <polygon points="150,100 200,150 150,200 100,150" fill="#D4A76A" stroke="#FFFFFF" strokeWidth="2" />
        
        {/* Bases */}
        <rect x="145" y="95" width="10" height="10" fill="white" stroke="#000000" strokeWidth="1" />
        <rect x="195" y="145" width="10" height="10" fill="white" stroke="#000000" strokeWidth="1" />
        <rect x="145" y="195" width="10" height="10" fill="white" stroke="#000000" strokeWidth="1" />
        <rect x="95" y="145" width="10" height="10" fill="white" stroke="#000000" strokeWidth="1" />
        
        {/* Pitcher's mound */}
        <circle cx="150" cy="150" r="8" fill="#D4A76A" stroke="#FFFFFF" strokeWidth="1" />
      </svg>
      
      {/* Player markers */}
      {Object.keys(POSITIONS).map(position => {
        const player = findPlayerByPosition(players, position);
        if (!player) return null;
        
        const { x, y } = POSITIONS[position];
        
        return (
          <div 
            key={position}
            className="absolute transform -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${(x / 300) * 100}%`, top: `${(y / 300) * 100}%` }}
          >
            {/* Player image */}
            <div className="relative">
              <div className="w-8 h-8 rounded-full overflow-hidden border-2 border-white">
                <Image 
                  src={player.imageUrl}
                  alt={player.name}
                  width={32}
                  height={32}
                  className="object-cover"
                />
              </div>
              
              {/* Name tag */}
              <div className="absolute top-6 left-1/2 transform -translate-x-1/2 mt-1 bg-white border border-gray-300 rounded-sm px-1 py-0.5 text-xs shadow-sm whitespace-nowrap">
                <span className="font-bold text-black text-opacity-70 text-xs uppercase">{position}</span>
                {' '}
                <span className="text-xs">
                  {player.name.split(' ')[0][0]}. {player.name.split(' ').slice(1).join(' ')}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default BaseballDiamond;