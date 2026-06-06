/** @type {import('next').NextConfig} */
const nextConfig = {
  // Emit a self-contained server bundle (.next/standalone) for the Docker image
  // used by Fly.io — only the traced runtime deps ship, keeping the image small.
  output: "standalone",
  // Coin photos are posted as multipart/form-data to the API route. The route
  // itself caps the payload; nothing special is needed here.
};

export default nextConfig;
