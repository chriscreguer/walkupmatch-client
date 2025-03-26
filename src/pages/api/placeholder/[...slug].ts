import { NextApiRequest, NextApiResponse } from 'next';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  // Get the slug from the URL
  const { slug } = req.query;
  
  // Set the content type to SVG
  res.setHeader('Content-Type', 'image/svg+xml');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  
  // Determine if this is an avatar or album placeholder
  const isAvatar = slug && Array.isArray(slug) && slug[0] === 'avatar';
  
  // Get size from slug or use default
  const size = slug && Array.isArray(slug) && slug[1] ? parseInt(slug[1], 10) : 200;
  
  if (isAvatar) {
    // Generate a user avatar placeholder
    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="#E5E5E5"/>
        <circle cx="100" cy="80" r="50" fill="#BBBBBB"/>
        <circle cx="100" cy="230" r="90" fill="#BBBBBB"/>
      </svg>
    `;
    res.status(200).send(svg);
  } else {
    // Generate an album art placeholder
    const svg = `
      <svg width="${size}" height="${size}" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        <rect width="200" height="200" fill="#E5E5E5"/>
        <circle cx="100" cy="100" r="80" fill="#BBBBBB"/>
        <circle cx="100" cy="100" r="20" fill="#E5E5E5"/>
      </svg>
    `;
    res.status(200).send(svg);
  }
}