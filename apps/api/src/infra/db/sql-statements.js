function parseError(state) {
  const error = new Error(`migration SQL ended inside ${state}`);
  error.code = "MIGRATION_SQL_PARSE_ERROR";
  error.details = { state };
  return error;
}

function isQuoteState(state) {
  return state === "single-quote" || state === "double-quote" || state === "backtick";
}

function quoteForState(state) {
  if (state === "single-quote") return "'";
  if (state === "double-quote") return '"';
  return "`";
}

export function splitSqlStatements(sql) {
  const source = String(sql || "");
  const statements = [];
  let buffer = "";
  let state = "normal";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") {
        buffer += "\n";
        state = "normal";
      }
      continue;
    }
    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        index += 1;
        state = "normal";
      }
      continue;
    }
    if (isQuoteState(state)) {
      buffer += character;
      const quote = quoteForState(state);
      if (character === "\\" && index + 1 < source.length) {
        buffer += source[index + 1];
        index += 1;
        continue;
      }
      if (character === quote && next === quote) {
        buffer += next;
        index += 1;
        continue;
      }
      if (character === quote) state = "normal";
      continue;
    }

    if (character === "'" || character === '"' || character === "`") {
      state = character === "'"
        ? "single-quote"
        : character === '"' ? "double-quote" : "backtick";
      buffer += character;
      continue;
    }
    if (character === "#") {
      buffer += " ";
      state = "line-comment";
      continue;
    }
    if (character === "-" && next === "-") {
      buffer += " ";
      index += 1;
      state = "line-comment";
      continue;
    }
    if (character === "/" && next === "*") {
      buffer += " ";
      index += 1;
      state = "block-comment";
      continue;
    }
    if (character === ";") {
      const statement = buffer.trim();
      if (statement) statements.push(statement);
      buffer = "";
      continue;
    }
    buffer += character;
  }

  if (state !== "normal" && state !== "line-comment") throw parseError(state);
  const finalStatement = buffer.trim();
  if (finalStatement) statements.push(finalStatement);
  return statements;
}
