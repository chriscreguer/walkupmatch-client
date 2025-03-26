import NextAuth, { NextAuthOptions } from "next-auth";
import SpotifyProvider from "next-auth/providers/spotify";

/**
 * Spotify scopes needed for our application:
 * - user-read-email: Read user's email
 * - user-read-private: Read user's subscription details
 * - user-top-read: Read user's top artists and tracks
 * - user-library-read: Read user's saved tracks and albums
 * - playlist-read-private: Read user's private playlists
 * - playlist-modify-public: Modify user's public playlists (to create the team playlist)
 * - playlist-modify-private: Modify user's private playlists
 */
const scopes = [
  "user-read-email",
  "user-read-private",
  "user-top-read",
  "user-library-read",
  "playlist-read-private",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

export const authOptions: NextAuthOptions = {
  providers: [
    SpotifyProvider({
      clientId: process.env.SPOTIFY_CLIENT_ID as string,
      clientSecret: process.env.SPOTIFY_CLIENT_SECRET as string,
      authorization: {
        params: { scope: scopes },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, user }) {
      // Initial sign in
      if (account && user) {
        return {
          ...token,
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          accessTokenExpires: account.expires_at ? account.expires_at * 1000 : Date.now() + 3600 * 1000, // Convert to milliseconds
          user,
        };
      }

      // Return previous token if the access token has not expired yet
      if (Date.now() < (token.accessTokenExpires as number)) {
        return token;
      }

      // Access token has expired, try to refresh it
      try {
        const response = await fetch("https://accounts.spotify.com/api/token", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(
              `${process.env.SPOTIFY_CLIENT_ID}:${process.env.SPOTIFY_CLIENT_SECRET}`
            ).toString("base64")}`,
          },
          body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: token.refreshToken as string,
          }),
        });

        const refreshedTokens = await response.json();

        if (!response.ok) {
          throw refreshedTokens;
        }

        return {
          ...token,
          accessToken: refreshedTokens.access_token,
          refreshToken: refreshedTokens.refresh_token ?? token.refreshToken,
          accessTokenExpires: Date.now() + refreshedTokens.expires_in * 1000,
        };
      } catch (error) {
        console.error("Error refreshing access token", error);
        return { ...token, error: "RefreshAccessTokenError" };
      }
    },
    async session({ session, token }) {
      // Send properties to the client
      session.accessToken = token.accessToken as string;
      session.error = token.error as string;
      
      // Use proper typing and safely add user properties
      if (token.user && typeof token.user === 'object') {
        // Create a typed user object with optional id
        const user = token.user as Record<string, unknown>;
        
        session.user = {
          ...session.user,
          // Only add id if it exists on token.user
          ...(user.hasOwnProperty('id') && { id: String(user.id) })
        };
      }
      
      return session;
    },
    async redirect({ url, baseUrl }) {
      // Redirect to the team page after successful sign-in
      if (url.startsWith(baseUrl)) return `${baseUrl}/team`;
      // Prevent open redirects
      else if (url.startsWith("/")) return `${baseUrl}${url}`;
      return baseUrl;
    },
  },
  pages: {
    signIn: "/", // Use the root page for signin
    signOut: "/",
    error: "/",   // Error page
  },
  secret: process.env.NEXTAUTH_SECRET,
  session: {
    strategy: "jwt",
    maxAge: 60 * 60, // 1 hour
  },
  debug: process.env.NODE_ENV === "development",
};

export default NextAuth(authOptions);