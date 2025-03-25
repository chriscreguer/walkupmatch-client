import SpotifyWebApi from "spotify-web-api-node";

const spotifyApi = new SpotifyWebApi({
  clientId: process.env.SPOTIFY_CLIENT_ID,
  clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
});

export const setAccessToken = (token: string) => {
  spotifyApi.setAccessToken(token);
};

export const getUserProfile = async () => {
  const data = await spotifyApi.getMe();
  return data.body;
};

export const getUserTopTracks = async () => {
  const data = await spotifyApi.getMyTopTracks({ limit: 50 });
  return data.body.items;
};

export const getUserSavedTracks = async () => {
  const data = await spotifyApi.getMySavedTracks({ limit: 50 });
  return data.body.items;
};

export default spotifyApi;