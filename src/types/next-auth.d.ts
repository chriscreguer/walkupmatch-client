import { DefaultSession } from "next-auth";

declare module "next-auth" {
  /**
   * Extend the built-in session types
   */
  interface Session {
    accessToken?: string;
    error?: string;
    user: {
      id?: string;
    } & DefaultSession["user"];
  }

  /**
   * Extend the built-in JWT types
   */
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    accessTokenExpires?: number;
    error?: string;
    user?: {
      id: string;
      name?: string;
      email?: string;
      image?: string;
    };
  }
}