// Stylelint 配置:延续项目事实风格 —— 2 空格缩进、属性选择器双引号、
// rgba(r, g, b, 0.12) 旧记法、min-width/max-width 媒体查询、kebab-case keyframes。
// 颜色 token 化属于语义重构,不在 lint 范围(硬编码色与 var(--…) 的收敛见风格审计)。
module.exports = {
  extends: ['stylelint-config-standard'],
  rules: {
    // 审计 #12:227 处双引号 vs 16 处单引号,统一为双引号
    'selector-attribute-quotes': 'always',
    // 颜色函数统一 rgb() 逗号记法(rgba 别名已全量归一为 rgb,值等价)
    'color-function-notation': 'legacy',
    'alpha-value-notation': 'number',
    // 媒体查询沿用 min-width/max-width 前缀记法
    'media-feature-range-notation': 'prefix',
    // 字体名与专有值保留惯用大小写
    'value-keyword-case': ['lower', {
      ignoreKeywords: ['BlinkMacSystemFont', 'Consolas', 'Menlo', 'optimizeLegibility'],
    }],
    // 调整选择器顺序会改变级联结果,不在此强制(58 处已在审计中记录)
    'no-descending-specificity': null,
  },
};
