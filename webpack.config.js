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
  // ⚠️ The entry is deliberately NOT one of the exposed modules.
  //
  // webpack-subresource-integrity fails with "unresolved integrity placeholders"
  // when the entry chunk and the federation container reference each other — the
  // hash of one is needed to compute the other. Keeping the entry as its own
  // small module breaks the cycle. This is why the entry is not './src/App.js'
  // even though App is what the host actually loads.
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
      // ⚠️ MUST be './App' — the host hardcodes `module="./App"` for every
      // registered extension. Exposing any other name produces a bundle that
      // verifies cleanly and then fails at runtime with "Module ./X does not
      // exist in container".
      // ⚠️ EXACTLY ONE EXPOSE, and it must be './App'.
      //
      // './App' because the host hardcodes `module="./App"` for every registered
      // extension; any other name verifies cleanly then fails at runtime with
      // "Module ./X does not exist in container".
      //
      // Exactly one because webpack-subresource-integrity cannot resolve a second
      // one here — measured, not assumed: adding './mod' back fails the build with
      // "unresolved integrity placeholders" even with react removed from `shared`,
      // while a single expose builds with react shared. The harness therefore
      // drives the lazy chunk through App's named `run()` export instead of a
      // separate module.
      exposes: { './App': './src/App.js' },
      shared: {
        // react/react-dom MUST be singletons: the host renders our component
        // inside its own tree, and a second React copy breaks hooks with the
        // invalid-hook-call error rather than anything that names the cause.
        react: { singleton: true, requiredVersion: '^19.0.0' },
        'react-dom': { singleton: true, requiredVersion: '^19.0.0' },
        // Fallback retained deliberately — this is the shape that ships.
        loglevel: { singleton: true, requiredVersion: '^1.9.2' },
      },
    }),
    new SubresourceIntegrityPlugin({ hashFuncNames: ['sha384'] }),
  ],
});
