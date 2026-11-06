// A single allowlist drives both local serving and deployment. Never copy the
// project root: it contains the optional server's .env and development files.
export const browserAssets = Object.freeze([
  'index.html',
  'styles.css',
  'app.js',
  'parser.js',
  'analyzer.js',
  'domain.js',
  'examples.js',
  'input.js',
  'naming.js',
  'api.js',
  'runtime-config.js',
  'ui/dom.js',
  'ui/views.js',
  'catalog.js',
  'product-examples.js',
  'ui/catalog.js',
  'ui/verification.js',
  'ui/workflow.js',
  'ui/quick-verification.js',
  'calculation/decimal.js',
  'calculation/expression.js',
  'calculation/verify.js',
  'calculation/asis-data.js',
  'calculation/reconciliation.js',
]);

export const contentTypes = Object.freeze({
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
});
