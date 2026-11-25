// 代码规范（Phase 0）：与项目现有风格一致 —— 4 空格缩进、单引号、分号。
// core 层保持零 cc 依赖，由 import 约束人工遵守（见 ARCHITECTURE.md）。
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    {
        ignores: ['build/**', 'library/**', 'temp/**', 'node_modules/**', 'extensions/**'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts'],
        rules: {
            'indent': ['error', 4],
            'quotes': ['error', 'single', { avoidEscape: true }],
            'semi': ['error', 'always'],
            'no-console': 'off',                       // Logger 直接使用 console
            '@typescript-eslint/no-explicit-any': 'off',   // 与 cc 无泛型 API 协作需保留
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
            '@typescript-eslint/no-empty-function': 'off',
        },
    },
    {
        files: ['tests/**/*.ts'],
        rules: {
            '@typescript-eslint/no-non-null-assertion': 'off',
        },
    },
);
