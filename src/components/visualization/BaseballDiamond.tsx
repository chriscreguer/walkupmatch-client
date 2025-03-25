import { useRef, useEffect } from 'react';
import * as d3 from 'd3';
import { MLBPlayer } from '../../lib/mlb/types';

interface BaseballDiamondProps {
  players: MLBPlayer[];
}

export default function BaseballDiamond({ players }: BaseballDiamondProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  
  // Position mapping for the baseball diamond
  const positions = {
    'P': { x: 0.5, y: 0.6 },  // Pitcher's mound
    'C': { x: 0.5, y: 0.9 },  // Catcher
    '1B': { x: 0.65, y: 0.75 }, // First base
    '2B': { x: 0.57, y: 0.43 }, // Second base
    '3B': { x: 0.35, y: 0.75 }, // Third base
    'SS': { x: 0.43, y: 0.43 }, // Shortstop
    'LF': { x: 0.25, y: 0.25 }, // Left field
    'CF': { x: 0.5, y: 0.15 },  // Center field
    'RF': { x: 0.75, y: 0.25 }, // Right field
    'DH': { x: 0.8, y: 0.9 },   // Designated hitter
    'SP': { x: 0.5, y: 0.6 },   // Starting pitcher (same as P)
    'RP': { x: 0.3, y: 0.9 }    // Relief pitcher
  };
  
  useEffect(() => {
    if (!svgRef.current || players.length === 0) return;
    
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    
    // Clear previous content
    svg.selectAll('*').remove();
    
    // Draw baseball field
    drawBaseballField(svg, width, height);
    
    // Place players on the field
    players.forEach(player => {
      const position = player.position;
      const pos = positions[position as keyof typeof positions];
      
      if (pos) {
        // Player circle/avatar
        const playerGroup = svg.append('g')
          .attr('transform', `translate(${pos.x * width}, ${pos.y * height})`);
        
        // Add player circular headshot container
        playerGroup.append('circle')
          .attr('r', 16)
          .attr('fill', 'white')
          .attr('stroke', 'white')
          .attr('stroke-width', 2);
        
        // Name card (rectangle below player)
        const nameCard = playerGroup.append('g')
          .attr('transform', 'translate(0, 20)');
          
        nameCard.append('rect')
          .attr('x', -40)
          .attr('y', 0)
          .attr('width', 80)
          .attr('height', 30)
          .attr('rx', 3)
          .attr('fill', 'white')
          .attr('stroke', '#dedede')
          .attr('stroke-width', 1);
          
        // Position label
        nameCard.append('text')
          .attr('x', -30)
          .attr('y', 12)
          .attr('font-size', '12px')
          .attr('font-weight', 'bold')
          .attr('fill', 'rgba(0, 0, 0, 0.7)')
          .text(position);
          
        // Player name (first initial, last name)
        const displayName = `${player.firstName.charAt(0)}. ${player.lastName}`;
        nameCard.append('text')
          .attr('x', -30)
          .attr('y', 24)
          .attr('font-size', '12px')
          .attr('fill', 'black')
          .text(displayName);
      }
    });
    
  }, [players]);
  
  // Function to draw the baseball field
  const drawBaseballField = (svg: d3.Selection<SVGSVGElement, unknown, null, undefined>, width: number, height: number) => {
    // Background
    svg.append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', '#E4E8E3')
      .attr('opacity', 0.7);
    
    // Infield diamond
    const infield = svg.append('g')
      .attr('transform', `translate(${width/2}, ${height/2})`);
      
    // Home plate to first base
    infield.append('line')
      .attr('x1', 0)
      .attr('y1', height * 0.3)
      .attr('x2', width * 0.2)
      .attr('y2', 0)
      .attr('stroke', 'white')
      .attr('stroke-width', 2);
      
    // First base to second base
    infield.append('line')
      .attr('x1', width * 0.2)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', -height * 0.3)
      .attr('stroke', 'white')
      .attr('stroke-width', 2);
      
    // Second base to third base
    infield.append('line')
      .attr('x1', 0)
      .attr('y1', -height * 0.3)
      .attr('x2', -width * 0.2)
      .attr('y2', 0)
      .attr('stroke', 'white')
      .attr('stroke-width', 2);
      
    // Third base to home plate
    infield.append('line')
      .attr('x1', -width * 0.2)
      .attr('y1', 0)
      .attr('x2', 0)
      .attr('y2', height * 0.3)
      .attr('stroke', 'white')
      .attr('stroke-width', 2);
      
    // Home plate
    infield.append('rect')
      .attr('x', -5)
      .attr('y', height * 0.3 - 5)
      .attr('width', 10)
      .attr('height', 10)
      .attr('fill', 'white');
      
    // Pitcher's mound
    infield.append('circle')
      .attr('cx', 0)
      .attr('cy', 0)
      .attr('r', 10)
      .attr('fill', '#D3D3D3');
  };
  
  return (
    <div className="w-full bg-opacity-70 p-4 rounded-lg">
      <h2 className="text-lg font-bold mb-4">Your Team Lineup</h2>
      <div className="w-full relative" style={{ paddingBottom: '75%' }}>
        <svg 
          ref={svgRef} 
          className="absolute top-0 left-0 w-full h-full"
          viewBox="0 0 100 75"
          preserveAspectRatio="xMidYMid meet"
        />
      </div>
    </div>
  );
}