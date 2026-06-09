/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { dev, isServer }) => {
    if (!dev && isServer) {
      // Fix: terser's variable name reuse across block scopes creates TDZ errors
      // when a `let` in outer scope gets the same minified name as a `const` in inner scope.
      // `safari10: true` disables this reuse pattern, eliminating the TDZ crash.
      config.optimization.minimizer?.forEach(minimizer => {
        if (minimizer.constructor?.name === 'TerserPlugin') {
          if (!minimizer.options) minimizer.options = {}
          if (!minimizer.options.terserOptions) minimizer.options.terserOptions = {}
          if (!minimizer.options.terserOptions.mangle) minimizer.options.terserOptions.mangle = {}
          minimizer.options.terserOptions.mangle.safari10 = true
        }
      })
    }
    return config
  },
}

module.exports = nextConfig
