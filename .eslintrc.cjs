module.exports = {
  root: true,
  env: { browser: true, es2020: true },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react-hooks/recommended',
  ],
  ignorePatterns: ['dist', '.eslintrc.cjs'],
  parser: '@typescript-eslint/parser',
  plugins: ['react-refresh'],
  rules: {
    // Fast Refresh ergonomics rule. Two standard React patterns legitimately
    // pair a component with a non-component export in the same module:
    //   - a Context provider alongside its consumer hook
    //   - a shadcn/ui component alongside its cva() variants
    // Naming them here keeps the rule active everywhere else rather than
    // switching it off wholesale.
    'react-refresh/only-export-components': [
      'warn',
      {
        allowConstantExport: true,
        allowExportNames: [
          'useAuth',
          'useNotifications',
          'useValueCoins',
          'buttonVariants',
          'badgeVariants',
        ],
      },
    ],
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/no-explicit-any': 'error',
  },
}
