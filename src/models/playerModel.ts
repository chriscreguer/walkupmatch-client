import mongoose from 'mongoose';

const playerSchema = new mongoose.Schema({
  id: { type: String, required: true },
  mlbId: { type: String, required: true },
  name: { type: String, required: true },
  position: { type: String, required: true },
  team: { type: String, required: true },
  teamId: { type: String, required: true },
  matchReason: String,
  rankInfo: String,
  matchScore: Number,
  lastUpdated: { type: Date, default: Date.now },
  stats: {
    batting: {
      battingAvg: Number,
      onBasePercentage: Number,
      sluggingPercentage: Number,
      plateAppearances: Number
    },
    pitching: {
      earnedRunAvg: Number,
      inningsPitched: Number
    }
  },
  walkupSongs: [{
    _id: false,
    id: { type: String, required: true },
    songName: { type: String, required: true },
    artistName: { type: String, required: true },
    artists: [{
      name: { type: String, required: true },
      role: { type: String, enum: ['primary', 'featured'], required: true }
    }],
    albumName: { type: String, default: '' },
    spotifyId: { type: String, default: '' },
    youtubeId: { type: String, default: '' },
    genre: { type: [String], default: [] },
    albumArt: { type: String, default: '' }
  }]
});

export const Player = mongoose.models.Player || mongoose.model('Player', playerSchema); 