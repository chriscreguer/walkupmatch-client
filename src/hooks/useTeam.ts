import { useState, useEffect, useCallback } from 'react';
import { useSession } from 'next-auth/react';
import { Team } from '../lib/mlb/types';

export function useTeam() {
  const { data: session, status } = useSession();
  const [team, setTeam] = useState<Team | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Use useCallback to memoize the fetchTeam function
  const fetchTeam = useCallback(async () => {
    if (status !== 'authenticated' || !session) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/team/generate');
      
      if (!response.ok) {
        throw new Error('Failed to generate team');
      }
      
      const teamData = await response.json();
      setTeam(teamData);
    } catch (err) {
      console.error('Error fetching team:', err);
      setError('Failed to generate your team. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [status, session]);

  // Generate team when session becomes available
  useEffect(() => {
    if (status === 'authenticated' && !team && !loading) {
      fetchTeam();
    }
  }, [status, team, loading, fetchTeam]);

  return {
    team,
    loading,
    error,
    refreshTeam: fetchTeam
  };
}