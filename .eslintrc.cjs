/**
 * This is intended to be a basic starting point for linting in your app.
 * It relies on recommended configs out of the box for simplicity, but you can
 * and should modify this configuration to best suit your team's needs.
 */

/** @type {import('eslint').Linter.Config} */
module.exports = {
  root: true,
  parserOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    ecmaFeatures: {
      jsx: true,
    },
  },
  env: {
    browser: true,
    commonjs: true,
    es6: true,
  },
  ignorePatterns: ["!**/.server", "!**/.client"],

  // Base config
  extends: ["eslint:recommended"],

  rules: {
    // The leading underscore is the deliberate "I am destructuring this out and
    // discarding it" convention — e.g. spread-and-omit when copying a database
    // row. Reporting those buries the genuinely unused variables.
    "no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
    ],
  },

  overrides: [
    // React
    {
      files: ["**/*.{js,jsx,ts,tsx}"],
      plugins: ["react", "jsx-a11y"],
      extends: [
        "plugin:react/recommended",
        "plugin:react/jsx-runtime",
        "plugin:react-hooks/recommended",
        "plugin:jsx-a11y/recommended",
      ],
      settings: {
        react: {
          version: "detect",
        },
        formComponents: ["Form"],
        linkComponents: [
          { name: "Link", linkAttribute: "to" },
          { name: "NavLink", linkAttribute: "to" },
        ],
        "import/resolver": {
          typescript: {},
        },
      },
      rules: {
        "react/no-unknown-property": ["error", { ignore: ["variant"] }],
      },
    },

    // Typescript
    {
      files: ["**/*.{ts,tsx}"],
      plugins: ["@typescript-eslint", "import"],
      parser: "@typescript-eslint/parser",
      settings: {
        "import/internal-regex": "^~/",
        "import/resolver": {
          node: {
            extensions: [".ts", ".tsx"],
          },
          typescript: {
            alwaysTryTypes: true,
          },
        },
      },
      extends: [
        "plugin:@typescript-eslint/recommended",
        "plugin:import/recommended",
        "plugin:import/typescript",
      ],
    },

    // Node
    //
    // Route modules are server code too — their loaders and actions run in Node
    // and legitimately read process.env. Without them listed here every such
    // access was reported as `no-undef`, which buried the real findings under
    // false ones and is why the lint script wasn't gating anything.
    {
      files: [
        ".eslintrc.cjs",
        "vite.config.{js,ts}",
        ".graphqlrc.{js,ts}",
        "shopify.server.{js,ts}",
        "**/*.server.{js,ts}",
        "app/routes/**/*.{js,jsx,ts,tsx}",
        "app/root.{js,jsx,ts,tsx}",
        "app/entry.server.{js,jsx,ts,tsx}",
        // Maintenance scripts are plain Node programs run with `node --env-file`.
        // Without this they report `process is not defined` on every use, which
        // is the same false-positive noise the override above exists to remove.
        "scripts/**/*.{js,mjs,cjs}",
        // The dedicated worker process — a plain Node program, run by pm2 as
        // `node workers/main.js` rather than through the react-router build.
        "workers/**/*.{js,mjs,cjs}",
        // The web entrypoint — loads .env, then hands off to react-router-serve
        // — and the shared .env loader both entrypoints import first.
        "server.js",
        "load-env.js",
        // pm2's process definition, which is CommonJS and uses __dirname.
        "ecosystem.config.cjs",
      ],
      env: {
        node: true,
      },
    },
  ],
  globals: {
    shopify: "readonly"
  },
};
