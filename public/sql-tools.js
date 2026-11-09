let sqlGrammar;

export function highlightSql(source) {
  const prism = globalThis.Prism;
  if (!sqlGrammar) {
    // Prism's generic SQL mode treats # as a comment; T-SQL uses it in temp tables.
    sqlGrammar = {
      ...prism.languages.sql,
      comment: /--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)/,
      identifier: { pattern: /\[(?:\]\]|[^\]])*\]/, greedy: true },
      function: /\b[A-Z_][\w$]*(?=\s*\()/i,
    };
  }
  return prism.highlight(source, sqlGrammar, 'sql');
}

export function formatSql(source) {
  return globalThis.sqlFormatter.format(source, {
    language: 'transactsql',
    tabWidth: 2,
    keywordCase: 'upper',
    functionCase: 'upper',
    linesBetweenQueries: 1,
  });
}
