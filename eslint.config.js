// ESLint 平面配置(ESLint 10 仅支持平面配置,格式类规则统一走 @stylistic)。
// 目标:把项目既有的事实风格固化为规则 ——
// 2 空格缩进、单引号、始终分号、多行尾逗号、模板字面量优先、const 优先。
// 语义层(命名一致性、注释语言、常量提取)不在 lint 范围,见 docs 中的风格审计。
const stylistic = require('@stylistic/eslint-plugin');
const globals = require('globals');
const { defineConfig, globalIgnores } = require('eslint/config');

// 全目录共用的风格与正确性规则
const sharedRules = {
  // —— 正确性 ——
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  'no-const-assign': 'error',
  'no-dupe-keys': 'error',
  'no-redeclare': 'error',
  'no-var': 'error',
  'prefer-const': 'error',
  'prefer-template': 'error',
  'eqeqeq': ['error', 'always', { null: 'ignore' }],
  'curly': ['error', 'multi-line'],

  // —— 格式(@stylistic,与仓库 .gitattributes 的 LF 约定配套) ——
  '@stylistic/indent': ['error', 2, { SwitchCase: 1 }],
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
  '@stylistic/semi': ['error', 'always'],
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/eol-last': 'error',
  '@stylistic/linebreak-style': ['error', 'unix'],
  '@stylistic/arrow-parens': ['error', 'always'],
  '@stylistic/template-curly-spacing': 'error',
  '@stylistic/brace-style': ['error', '1tbs', { allowSingleLine: true }],
};

module.exports = defineConfig(
  globalIgnores([
    'dist/**',
    'tmp/**',
    'node_modules/**',
    '.dsh-ops/**',
    'docs/**',
    'app/ui/**',
  ]),

  // 服务端与开发脚本:Node 环境,CommonJS
  {
    files: ['app/server/**/*.js', 'dev/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    plugins: { '@stylistic': stylistic },
    rules: sharedRules,
  },

  // 前端脚本:浏览器环境,普通 <script>(非模块)
  {
    files: ['app/www/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    plugins: { '@stylistic': stylistic },
    rules: sharedRules,
  },
);
