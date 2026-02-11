import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === 'production';
const repoName = process.env.NEXT_PUBLIC_REPO_NAME || '';
const basePath = isProd && repoName ? `/${repoName}` : '';

const nextConfig: NextConfig = {
  output: 'export',

  // GitHub Pages serves from /<repo-name>/
  basePath,
  assetPrefix: isProd && repoName ? `/${repoName}/` : '',

  images: {
    unoptimized: true,
  },

  // Trailing slashes for static file serving
  trailingSlash: true,

  // Expose basePath to client code via env
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
};

export default nextConfig;
