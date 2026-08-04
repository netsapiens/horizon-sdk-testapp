// Clean-room Module Federation remote built to the Horizon bundle-verification
// requirements (design §5), used to verify the browser actually ENFORCES chunk
// integrity — not merely that webpack emits the values.
//
// Shared config matches the corrected recipe: fallback copies RETAINED (they get
// integrity values like any other chunk), and no module the host doesn't provide.
const path = require('path');
const ModuleFederationPlugin = require('webpack/lib/container/ModuleFederationPlugin');
const { SubresourceIntegrityPlugin } = require('webpack-subresource-integrity');

const VERSION = require('./package.json').version;

module.exports = (_env, argv) => ({
  mode: argv.mode || 'production',
  entry: './src/index.js',
  output: {
    path: path.resolve(__dirname, 'dist', `v${VERSION}`),
    publicPath: 'auto',
    filename: '[name].[contenthash].js',
    chunkFilename: '[id].[contenthash].js',
    crossOriginLoading: 'anonymous', // REQUIRED for SRI
    clean: true,
  },
  devtool: 'source-map',
  plugins: [
    new ModuleFederationPlugin({
      name: 'minimalRemote',
      filename: 'remoteEntry.js',
      exposes: { './mod': './src/index.js' },
      shared: {
        // Fallback retained deliberately — this is the shape that ships.
        loglevel: { singleton: true, requiredVersion: '^1.9.2' },
      },
    }),
    new SubresourceIntegrityPlugin({ hashFuncNames: ['sha384'] }),
  ],
});
