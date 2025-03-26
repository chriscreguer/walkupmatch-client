import { useSession, signIn, signOut } from "next-auth/react";
import { Session } from "next-auth";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Hook to check if user is authenticated and redirect if not
 * @param redirectTo - Where to redirect if user is not authenticated
 * @returns The session and loading state
 */
export function useRequireAuth(redirectTo: string = "/") {
  const { data: session, status } = useSession();
  const loading = status === "loading";
  const router = useRouter();

  useEffect(() => {
    if (!loading && !session) {
      router.push(redirectTo);
    }
  }, [session, loading, redirectTo, router]);

  return { session, loading };
}

/**
 * Hook to handle Spotify authentication
 * @returns Methods and state for Spotify authentication
 */
export function useSpotifyAuth() {
  const { data: session, status } = useSession();
  const isLoading = status === "loading";
  const isAuthenticated = !!session;

  // Login with Spotify
  const loginWithSpotify = () => {
    signIn("spotify", { callbackUrl: "/team" });
  };

  // Logout
  const logout = () => {
    signOut({ callbackUrl: "/" });
  };

  return {
    session,
    isLoading,
    isAuthenticated,
    loginWithSpotify,
    logout,
  };
}

/**
 * Get the Spotify access token from the session
 * @returns The Spotify access token or null if not available
 */
export function getSpotifyToken(session: Session | null) {
  return session?.accessToken || null;
}