import objectPlugin from "@jsep-plugin/object";
import jsep from "jsep";
import type { Expression } from "jsep";

import { normalizedAstNodeSchema } from "./custom-rule-contract";
import type { CustomRuleScope, NormalizedAstNode } from "./custom-rule-types";

const MAX_FORMULA_BYTES = 16 * 1024;
const MAX_AST_DEPTH = 20;
const MAX_AST_NODES = 300;
const MAX_SAFE_PARSE_NESTING = 256;

const ALLOWED_PREFIXES = new Set<CustomRuleScope>([
  "payable",
  "receivable",
  "external_cost",
  "reconciliation",
]);
const ALLOWED_UNARY_OPERATORS = new Set(["!", "+", "-"]);
const ALLOWED_BINARY_OPERATORS = new Set([
  "+",
  "-",
  "*",
  "/",
  "%",
  "==",
  "!=",
  "===",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "&&",
  "||",
]);

export type CustomRuleSourceSpan = {
  start: number;
  end: number;
};

export type CustomRuleIssue = {
  code: string;
  message: string;
  span: CustomRuleSourceSpan;
  path?: string;
};

export type ParseCustomRuleFormulaResult =
  | {
      ok: true;
      scopePrefix: CustomRuleScope | null;
      ast: NormalizedAstNode;
      spansByPath: Record<string, CustomRuleSourceSpan>;
    }
  | { ok: false; issues: CustomRuleIssue[] };

type LocatedExpression = Expression & {
  start?: number;
  end?: number;
  optional?: boolean;
};

type JsepParser = {
  expr: string;
  index: number;
  parse(): Expression;
  gobbleExpression(): Expression | false | undefined;
  gobbleToken(): Expression | false | undefined;
};

type JsepHookEnvironment = {
  context?: JsepParser;
  node?: Expression;
};

type JsepHookCallback = (
  this: JsepParser | JsepHookEnvironment,
  environment: JsepHookEnvironment,
) => void;

type JsepPlugin = {
  name: string;
  init(parser: JsepStatic): void;
};

type JsepStatic = (new (expression: string) => JsepParser) &
  Record<string, unknown> & {
    hooks: IsolatedJsepHooks;
    plugins: IsolatedJsepPlugins;
  };

type ObjectProperty = {
  type: string;
  computed?: boolean;
  shorthand?: boolean;
  key?: LocatedExpression;
  value?: LocatedExpression;
};

type TranslationContext = {
  bodyOffset: number;
  fallbackSpan: CustomRuleSourceSpan;
  nodeCount: number;
  spansByPath: Record<string, CustomRuleSourceSpan>;
};

class ParserFailure extends Error {
  constructor(readonly issue: CustomRuleIssue) {
    super(issue.message);
    this.name = "ParserFailure";
  }
}

class IsolatedJsepHooks {
  add(
    name:
      | string
      | readonly string[]
      | Readonly<Record<string, JsepHookCallback>>,
    callback?: JsepHookCallback | boolean,
    first = false,
  ): void {
    if (typeof name === "object" && !Array.isArray(name)) {
      for (const [hookName, hookCallback] of Object.entries(name)) {
        this.add(hookName, hookCallback, callback === true);
      }
      return;
    }

    for (const hookName of Array.isArray(name) ? name : [name]) {
      const callbacks = this.callbacksFor(hookName);
      if (typeof callback === "function") {
        callbacks[first ? "unshift" : "push"](callback);
      }
    }
  }

  run(name: string, environment: JsepHookEnvironment): void {
    const context = environment.context ?? environment;
    for (const callback of this.callbacksFor(name)) {
      callback.call(context, environment);
    }
  }

  private callbacksFor(name: string): JsepHookCallback[] {
    const record = this as unknown as Record<string, unknown>;
    const existing = record[name];
    if (Array.isArray(existing)) {
      return existing as JsepHookCallback[];
    }
    const callbacks: JsepHookCallback[] = [];
    record[name] = callbacks;
    return callbacks;
  }
}

class IsolatedJsepPlugins {
  readonly registered: Record<string, JsepPlugin> = Object.create(null) as Record<
    string,
    JsepPlugin
  >;

  constructor(private readonly parser: JsepStatic) {}

  register(...plugins: JsepPlugin[]): void {
    for (const plugin of plugins) {
      if (
        typeof plugin !== "object" ||
        typeof plugin.name !== "string" ||
        typeof plugin.init !== "function"
      ) {
        throw new TypeError("Invalid JSEP plugin format");
      }
      if (Object.hasOwn(this.registered, plugin.name)) {
        continue;
      }
      plugin.init(this.parser);
      this.registered[plugin.name] = plugin;
    }
  }
}

const JSEP_FIXED_STATE = {
  COMPOUND: "Compound",
  SEQUENCE_EXP: "SequenceExpression",
  IDENTIFIER: "Identifier",
  MEMBER_EXP: "MemberExpression",
  LITERAL: "Literal",
  THIS_EXP: "ThisExpression",
  CALL_EXP: "CallExpression",
  UNARY_EXP: "UnaryExpression",
  BINARY_EXP: "BinaryExpression",
  ARRAY_EXP: "ArrayExpression",
  TAB_CODE: 9,
  LF_CODE: 10,
  CR_CODE: 13,
  SPACE_CODE: 32,
  PERIOD_CODE: 46,
  COMMA_CODE: 44,
  SQUOTE_CODE: 39,
  DQUOTE_CODE: 34,
  OPAREN_CODE: 40,
  CPAREN_CODE: 41,
  OBRACK_CODE: 91,
  CBRACK_CODE: 93,
  QUMARK_CODE: 63,
  SEMCOL_CODE: 59,
  COLON_CODE: 58,
  max_unop_len: 1,
  max_binop_len: 3,
  this_str: "this",
} as const;

const JSEP_STATE_KEYS = [
  ...Object.keys(JSEP_FIXED_STATE),
  "hooks",
  "plugins",
  "unary_ops",
  "binary_ops",
  "right_associative",
  "additional_identifier_chars",
  "literals",
] as const;

export function parseCustomRuleFormula(
  formula: string,
): ParseCustomRuleFormulaResult {
  if (Buffer.byteLength(formula, "utf8") > MAX_FORMULA_BYTES) {
    return failure(
      "PARSE_FORMULA_TOO_LARGE",
      "Formula exceeds the 16 KiB UTF-8 limit",
      wholeFormulaSpan(formula),
    );
  }

  const extracted = extractFormulaBody(formula);
  if (!extracted.ok) {
    return extracted.result;
  }

  const { body, bodyOffset, scopePrefix } = extracted;
  const bodySpan = {
    start: bodyOffset,
    end: bodyOffset + body.length,
  };

  if (body.length === 0) {
    return failure("PARSE_EMPTY_FORMULA", "Formula is empty", bodySpan);
  }

  const forbidden = findForbiddenSyntax(body, bodyOffset);
  if (forbidden) {
    return { ok: false, issues: [forbidden] };
  }

  try {
    const parsed = parseWithLocations(body);
    const context: TranslationContext = {
      bodyOffset,
      fallbackSpan: bodySpan,
      nodeCount: 0,
      spansByPath: {},
    };
    const ast = translateNode(parsed as LocatedExpression, "$", 1, context);
    const schemaResult = normalizedAstNodeSchema.safeParse(
      copyOwnData(ast),
    );
    if (!schemaResult.success) {
      throw parserFailure(
        "PARSE_INVALID_IDENTIFIER",
        "Formula contains a noncanonical or reserved identifier",
        context.spansByPath["$"] ?? bodySpan,
      );
    }

    return {
      ok: true,
      scopePrefix,
      ast: schemaResult.data,
      spansByPath: context.spansByPath,
    };
  } catch (error) {
    if (error instanceof ParserFailure) {
      return { ok: false, issues: [error.issue] };
    }

    const errorIndex = readJsepErrorIndex(error);
    const start = Math.min(bodyOffset + errorIndex, bodySpan.end);
    return failure(
      "PARSE_SYNTAX_ERROR",
      "Formula syntax is invalid",
      { start, end: Math.min(start + 1, bodySpan.end) },
    );
  }
}

function extractFormulaBody(
  formula: string,
):
  | {
      ok: true;
      body: string;
      bodyOffset: number;
      scopePrefix: CustomRuleScope | null;
    }
  | { ok: false; result: ParseCustomRuleFormulaResult } {
  const leadingWhitespace = /^\s*/.exec(formula)?.[0].length ?? 0;
  const candidate = formula.slice(leadingWhitespace);
  const allowedMatch =
    /^(payable|receivable|external_cost|reconciliation)\s*=(?!=|>)\s*/.exec(
      candidate,
    );

  if (allowedMatch) {
    const prefix = allowedMatch[1];
    if (!prefix || !ALLOWED_PREFIXES.has(prefix as CustomRuleScope)) {
      return {
        ok: false,
        result: failure(
          "PARSE_INVALID_PREFIX",
          "Formula prefix is not supported",
          { start: leadingWhitespace, end: leadingWhitespace + (prefix?.length ?? 0) },
        ),
      };
    }

    const bodyOffset = leadingWhitespace + allowedMatch[0].length;
    return {
      ok: true,
      body: formula.slice(bodyOffset).trimEnd(),
      bodyOffset,
      scopePrefix: prefix as CustomRuleScope,
    };
  }

  const assignmentMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=(?!=|>)/.exec(
    candidate,
  );
  if (assignmentMatch) {
    const identifier = assignmentMatch[1] ?? "";
    return {
      ok: false,
      result: failure(
        "PARSE_INVALID_PREFIX",
        "Only a supported settlement scope may prefix a formula",
        {
          start: leadingWhitespace,
          end: leadingWhitespace + identifier.length,
        },
      ),
    };
  }

  const bodyOffset = leadingWhitespace;
  return {
    ok: true,
    body: formula.slice(bodyOffset).trimEnd(),
    bodyOffset,
    scopePrefix: null,
  };
}

function parseWithLocations(body: string): Expression {
  return withIsolatedJsepState((JsepConstructor) => {
    const parser = new JsepConstructor(body);
    instrumentParserMethod(parser, "gobbleToken");
    instrumentParserMethod(parser, "gobbleExpression");
    return parser.parse();
  });
}

function withIsolatedJsepState<Result>(
  operation: (parser: JsepStatic) => Result,
): Result {
  const JsepConstructor = (
    jsep as unknown as { Jsep: JsepStatic }
  ).Jsep;
  const descriptors = new Map<
    (typeof JSEP_STATE_KEYS)[number],
    PropertyDescriptor | undefined
  >();

  for (const key of JSEP_STATE_KEYS) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(JsepConstructor, key));
  }

  try {
    const hooks = new IsolatedJsepHooks();
    const plugins = new IsolatedJsepPlugins(JsepConstructor);
    Object.assign(JsepConstructor, JSEP_FIXED_STATE, {
      hooks,
      plugins,
      unary_ops: { "-": 1, "!": 1, "~": 1, "+": 1 },
      binary_ops: {
        "||": 1,
        "??": 1,
        "&&": 2,
        "|": 3,
        "^": 4,
        "&": 5,
        "==": 6,
        "!=": 6,
        "===": 6,
        "!==": 6,
        "<": 7,
        ">": 7,
        "<=": 7,
        ">=": 7,
        "<<": 8,
        ">>": 8,
        ">>>": 8,
        "+": 9,
        "-": 9,
        "*": 10,
        "/": 10,
        "%": 10,
        "**": 11,
      },
      right_associative: new Set(["**"]),
      additional_identifier_chars: new Set(["$", "_"]),
      literals: { true: true, false: false, null: null },
    });
    plugins.register(objectPlugin as unknown as JsepPlugin);
    return operation(JsepConstructor);
  } finally {
    for (const key of JSEP_STATE_KEYS) {
      const descriptor = descriptors.get(key);
      if (descriptor) {
        Object.defineProperty(JsepConstructor, key, descriptor);
      } else {
        delete JsepConstructor[key];
      }
    }
  }
}

function instrumentParserMethod(
  parser: JsepParser,
  methodName: "gobbleToken" | "gobbleExpression",
): void {
  const original = parser[methodName].bind(parser);
  parser[methodName] = () => {
    const initialIndex = parser.index;
    const node = original();
    if (node && typeof node === "object") {
      const start = trimSpanStart(parser.expr, initialIndex, parser.index);
      const end = trimSpanEnd(parser.expr, start, parser.index);
      const located = node as LocatedExpression;
      located.start =
        located.start === undefined ? start : Math.min(located.start, start);
      located.end = located.end === undefined ? end : Math.max(located.end, end);
    }
    return node;
  };
}

function translateNode(
  node: LocatedExpression,
  path: string,
  depth: number,
  context: TranslationContext,
): NormalizedAstNode {
  const span = sourceSpan(node, context);
  context.spansByPath[path] = span;

  if (depth > MAX_AST_DEPTH) {
    throw parserFailure(
      "PARSE_AST_TOO_DEEP",
      `Formula AST depth exceeds ${MAX_AST_DEPTH}`,
      span,
      path,
    );
  }
  context.nodeCount += 1;
  if (context.nodeCount > MAX_AST_NODES) {
    throw parserFailure(
      "PARSE_AST_TOO_LARGE",
      `Formula AST node count exceeds ${MAX_AST_NODES}`,
      span,
      path,
    );
  }

  switch (node.type) {
    case "Literal":
      return translateLiteral(node, span, path);
    case "Identifier":
      return {
        kind: "identifier",
        name: readIdentifier(node, span, path),
      };
    case "UnaryExpression": {
      const operator = readString(node.operator);
      if (!operator || !ALLOWED_UNARY_OPERATORS.has(operator)) {
        throw parserFailure(
          "PARSE_UNSUPPORTED_OPERATOR",
          "Unary operator is not allowed",
          span,
          path,
        );
      }
      return {
        kind: "unary",
        operator,
        argument: translateChild(node.argument, `${path}.argument`, depth, context),
      };
    }
    case "BinaryExpression": {
      const operator = readString(node.operator);
      if (!operator || !ALLOWED_BINARY_OPERATORS.has(operator)) {
        throw parserFailure(
          "PARSE_UNSUPPORTED_OPERATOR",
          "Binary operator is not allowed",
          span,
          path,
        );
      }
      return {
        kind: "binary",
        operator,
        left: translateChild(node.left, `${path}.left`, depth, context),
        right: translateChild(node.right, `${path}.right`, depth, context),
      };
    }
    case "CallExpression": {
      if (node.optional === true) {
        throw parserFailure(
          "PARSE_UNSUPPORTED_NODE",
          "Optional calls are not allowed",
          span,
          path,
        );
      }
      const callee = asLocatedExpression(node.callee);
      if (!callee || callee.type !== "Identifier") {
        throw parserFailure(
          "PARSE_UNSUPPORTED_NODE",
          "Only direct calls to named functions are allowed",
          span,
          path,
        );
      }
      const calleeName = readIdentifier(callee, span, path);
      const argumentsValue = Array.isArray(node.arguments) ? node.arguments : null;
      if (!argumentsValue) {
        throw parserFailure(
          "PARSE_UNSUPPORTED_NODE",
          "Call arguments are invalid",
          span,
          path,
        );
      }
      return {
        kind: "call",
        callee: calleeName,
        arguments: argumentsValue.map((argument, index) =>
          translateUnknownChild(
            argument,
            `${path}.arguments[${index}]`,
            depth,
            context,
          ),
        ),
      };
    }
    case "ArrayExpression": {
      const elements = Array.isArray(node.elements) ? node.elements : null;
      if (!elements || elements.some((element) => element === null)) {
        throw parserFailure(
          "PARSE_UNSUPPORTED_NODE",
          "Array holes are not allowed",
          span,
          path,
        );
      }
      return {
        kind: "array",
        elements: elements.map((element, index) =>
          translateUnknownChild(
            element,
            `${path}.elements[${index}]`,
            depth,
            context,
          ),
        ),
      };
    }
    case "ObjectExpression":
      return translateObject(node, path, depth, context);
    default:
      throw parserFailure(
        "PARSE_UNSUPPORTED_NODE",
        "Expression node is not allowed",
        span,
        path,
      );
  }
}

function translateLiteral(
  node: LocatedExpression,
  span: CustomRuleSourceSpan,
  path: string,
): NormalizedAstNode {
  const value = node.value;
  if (
    value !== null &&
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    throw parserFailure(
      "PARSE_UNSUPPORTED_NODE",
      "Literal type is not allowed",
      span,
      path,
    );
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw parserFailure(
      "PARSE_UNSUPPORTED_NODE",
      "Numeric literals must be finite",
      span,
      path,
    );
  }
  return { kind: "literal", value };
}

function translateObject(
  node: LocatedExpression,
  path: string,
  depth: number,
  context: TranslationContext,
): NormalizedAstNode {
  const properties = Array.isArray(node.properties) ? node.properties : null;
  if (!properties) {
    throw parserFailure(
      "PARSE_UNSUPPORTED_NODE",
      "Object properties are invalid",
      sourceSpan(node, context),
      path,
    );
  }

  return {
    kind: "object",
    entries: properties.map((propertyValue, index) => {
      const property = propertyValue as ObjectProperty;
      const propertyPath = `${path}.entries[${index}]`;
      if (
        property?.type !== "Property" ||
        property.computed !== false ||
        property.shorthand !== false ||
        !property.key ||
        !property.value
      ) {
        throw parserFailure(
          "PARSE_UNSUPPORTED_NODE",
          "Only explicit, noncomputed object properties are allowed",
          sourceSpan(node, context),
          propertyPath,
        );
      }

      const key = readObjectKey(
        property.key,
        sourceSpan(property.key, context),
        propertyPath,
      );
      return {
        key,
        value: translateNode(
          property.value,
          `${propertyPath}.value`,
          depth + 1,
          context,
        ),
      };
    }),
  };
}

function translateChild(
  child: unknown,
  path: string,
  parentDepth: number,
  context: TranslationContext,
): NormalizedAstNode {
  return translateUnknownChild(child, path, parentDepth, context);
}

function translateUnknownChild(
  child: unknown,
  path: string,
  parentDepth: number,
  context: TranslationContext,
): NormalizedAstNode {
  const expression = asLocatedExpression(child);
  if (!expression) {
    throw parserFailure(
      "PARSE_UNSUPPORTED_NODE",
      "Expression child is invalid",
      context.fallbackSpan,
      path,
    );
  }
  return translateNode(expression, path, parentDepth + 1, context);
}

function readObjectKey(
  key: LocatedExpression,
  span: CustomRuleSourceSpan,
  path: string,
): string {
  if (key.type === "Identifier") {
    return validateObjectKey(readString(key.name), span, path);
  }
  if (key.type === "Literal" && typeof key.value === "string") {
    return validateObjectKey(key.value, span, path);
  }
  throw parserFailure(
    "PARSE_UNSUPPORTED_NODE",
    "Object keys must be canonical identifiers",
    span,
    path,
  );
}

function validateObjectKey(
  name: string | null,
  span: CustomRuleSourceSpan,
  path: string,
): string {
  if (
    !name ||
    name !== name.trim() ||
    !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) ||
    ["__proto__", "prototype", "constructor"].includes(name.toLowerCase())
  ) {
    throw parserFailure(
      "PARSE_INVALID_IDENTIFIER",
      "Object key is noncanonical or reserved",
      span,
      path,
    );
  }
  return name;
}

function readIdentifier(
  node: LocatedExpression,
  fallbackSpan: CustomRuleSourceSpan,
  path: string,
): string {
  const name = readString(node.name);
  if (!name) {
    throw parserFailure(
      "PARSE_INVALID_IDENTIFIER",
      "Identifier is invalid",
      fallbackSpan,
      path,
    );
  }
  return validateIdentifier(name, fallbackSpan, path);
}

function validateIdentifier(
  name: string,
  span: CustomRuleSourceSpan,
  path: string,
): string {
  if (
    !normalizedAstNodeSchema.safeParse(
      copyOwnData({ kind: "identifier", name }),
    ).success
  ) {
    throw parserFailure(
      "PARSE_INVALID_IDENTIFIER",
      "Identifier is noncanonical, reserved, or ambiguous",
      span,
      path,
    );
  }
  return name;
}

function copyOwnData(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(copyOwnData);
  }
  if (value !== null && typeof value === "object") {
    const copy = Object.create(null) as Record<string, unknown>;
    for (const key of Object.keys(value)) {
      copy[key] = copyOwnData((value as Record<string, unknown>)[key]);
    }
    return copy;
  }
  return value;
}

function asLocatedExpression(value: unknown): LocatedExpression | null {
  if (
    value === null ||
    typeof value !== "object" ||
    typeof (value as { type?: unknown }).type !== "string"
  ) {
    return null;
  }
  return value as LocatedExpression;
}

function sourceSpan(
  node: LocatedExpression,
  context: TranslationContext,
): CustomRuleSourceSpan {
  if (
    typeof node.start === "number" &&
    Number.isSafeInteger(node.start) &&
    typeof node.end === "number" &&
    Number.isSafeInteger(node.end) &&
    node.end >= node.start
  ) {
    return {
      start: context.bodyOffset + node.start,
      end: context.bodyOffset + node.end,
    };
  }
  return context.fallbackSpan;
}

function findForbiddenSyntax(
  body: string,
  bodyOffset: number,
): CustomRuleIssue | null {
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  let nesting = 0;
  let unaryRun = 0;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] ?? "";
    const next = body[index + 1] ?? "";
    const previous = body[index - 1] ?? "";

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }

    if (character === "\"" || character === "'") {
      quote = character;
      unaryRun = 0;
      continue;
    }
    if (character === "`") {
      return syntaxIssue(bodyOffset + index, "Template literals are not allowed");
    }
    if (
      character === "?" &&
      next !== "." &&
      next !== "?" &&
      previous !== "?"
    ) {
      return {
        code: "PARSE_UNSUPPORTED_NODE",
        message: "Conditional expressions are not allowed",
        span: { start: bodyOffset + index, end: bodyOffset + index + 1 },
      };
    }
    if (body.slice(index, index + 3) === "...") {
      return syntaxIssue(bodyOffset + index, "Spread syntax is not allowed");
    }
    if (
      (character === "+" && next === "+") ||
      (character === "-" && next === "-")
    ) {
      return syntaxIssue(bodyOffset + index, "Update operators are not allowed");
    }
    if (character === "=" && next === ">") {
      return syntaxIssue(bodyOffset + index, "Arrow functions are not allowed");
    }
    if (
      character === "=" &&
      previous !== "=" &&
      previous !== "!" &&
      previous !== "<" &&
      previous !== ">" &&
      next !== "="
    ) {
      return syntaxIssue(bodyOffset + index, "Assignments are not allowed");
    }
    if (character === "{" || character === "[" || character === "(") {
      nesting += 1;
      if (nesting > MAX_SAFE_PARSE_NESTING) {
        return {
          code: "PARSE_AST_TOO_DEEP",
          message: `Formula nesting exceeds the safe parser limit`,
          span: { start: bodyOffset + index, end: bodyOffset + index + 1 },
        };
      }
    } else if (character === "}" || character === "]" || character === ")") {
      nesting = Math.max(0, nesting - 1);
    }

    if (character === "!" || character === "+" || character === "-") {
      unaryRun += 1;
      if (unaryRun > MAX_AST_DEPTH) {
        return {
          code: "PARSE_AST_TOO_DEEP",
          message: `Formula AST depth exceeds ${MAX_AST_DEPTH}`,
          span: { start: bodyOffset + index, end: bodyOffset + index + 1 },
        };
      }
    } else if (!/\s/.test(character)) {
      unaryRun = 0;
    }
  }

  const unsupportedKeyword =
    /\b(?:async|await|class|delete|function|instanceof|new|return|typeof|void|yield)\b/.exec(
      stripQuotedText(body),
    );
  if (unsupportedKeyword) {
    return syntaxIssue(
      bodyOffset + unsupportedKeyword.index,
      "Statement and function syntax is not allowed",
    );
  }

  const blockAfterCall = /\)\s*\{/.exec(stripQuotedText(body));
  if (blockAfterCall) {
    return syntaxIssue(
      bodyOffset + blockAfterCall.index,
      "Block syntax is not allowed",
    );
  }

  return null;
}

function stripQuotedText(value: string): string {
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  let stripped = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      stripped += " ";
    } else if (character === "\"" || character === "'") {
      quote = character;
      stripped += " ";
    } else {
      stripped += character;
    }
  }

  return stripped;
}

function syntaxIssue(index: number, message: string): CustomRuleIssue {
  return {
    code: "PARSE_SYNTAX_ERROR",
    message,
    span: { start: index, end: index + 1 },
  };
}

function parserFailure(
  code: string,
  message: string,
  span: CustomRuleSourceSpan,
  path?: string,
): ParserFailure {
  return new ParserFailure({
    code,
    message,
    span,
    ...(path === undefined ? {} : { path }),
  });
}

function failure(
  code: string,
  message: string,
  span: CustomRuleSourceSpan,
): ParseCustomRuleFormulaResult {
  return { ok: false, issues: [{ code, message, span }] };
}

function readJsepErrorIndex(error: unknown): number {
  if (
    error !== null &&
    typeof error === "object" &&
    typeof (error as { index?: unknown }).index === "number"
  ) {
    const index = (error as { index: number }).index;
    return Number.isSafeInteger(index) && index >= 0 ? index : 0;
  }
  return 0;
}

function trimSpanStart(value: string, start: number, end: number): number {
  let index = start;
  while (index < end && /\s/.test(value[index] ?? "")) {
    index += 1;
  }
  return index;
}

function trimSpanEnd(value: string, start: number, end: number): number {
  let index = end;
  while (index > start && /\s/.test(value[index - 1] ?? "")) {
    index -= 1;
  }
  return index;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function wholeFormulaSpan(formula: string): CustomRuleSourceSpan {
  return { start: 0, end: formula.length };
}
