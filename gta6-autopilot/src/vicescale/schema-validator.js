// Validador mínimo de JSON Schema, cobrindo apenas as palavras-chave que o
// servidor ViceScale usa hoje (ver catalog.json). Palavra-chave desconhecida
// gera erro para que uma mudança de schema no servidor não passe em silêncio.

const SUPPORTED = new Set([
  '$schema', 'type', 'properties', 'required', 'additionalProperties', 'items',
  'enum', 'minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems',
  'format', 'description', 'default',
]);

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

const matchesType = (value, expected) => {
  const actual = typeOf(value);
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return actual === expected;
};

const isUri = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
};

const validateNode = (schema, value, path, errors) => {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) {
      errors.push(`${path || '(raiz)'}: palavra-chave de schema não suportada "${key}"`);
    }
  }

  if (schema.type && !matchesType(value, schema.type)) {
    errors.push(`${path || '(raiz)'}: esperado ${schema.type}, recebido ${typeOf(value)}`);
    return;
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: valor "${value}" fora de [${schema.enum.join(', ')}]`);
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: mínimo ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: máximo ${schema.maximum}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: mínimo ${schema.minLength} caracteres`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: máximo ${schema.maxLength} caracteres`);
    if (schema.format === 'uri' && !isUri(value)) errors.push(`${path}: URL inválida`);
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: mínimo ${schema.minItems} itens`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: máximo ${schema.maxItems} itens`);
    if (schema.items) value.forEach((item, i) => validateNode(schema.items, item, `${path}[${i}]`, errors));
  }

  if (typeOf(value) === 'object') {
    const properties = schema.properties ?? {};
    for (const name of schema.required ?? []) {
      if (value[name] === undefined) errors.push(`${path ? `${path}.` : ''}${name}: obrigatório`);
    }
    for (const [name, child] of Object.entries(value)) {
      const childPath = path ? `${path}.${name}` : name;
      if (properties[name]) validateNode(properties[name], child, childPath, errors);
      else if (schema.additionalProperties === false) errors.push(`${childPath}: parâmetro não aceito pelo servidor`);
    }
  }
};

const validateLocalRules = (rules, value, errors) => {
  if (!rules) return;
  if (rules.oneOf) {
    const matched = rules.oneOf.filter((alt) => alt.required.every((k) => value[k] !== undefined));
    if (matched.length !== 1) {
      const options = rules.oneOf.map((alt) => alt.required.join('+')).join(' OU ');
      errors.push(`informe exatamente um entre: ${options}`);
    }
  }
  for (const [field, deps] of Object.entries(rules.dependentRequired ?? {})) {
    if (value[field] === undefined) continue;
    for (const dep of deps) {
      if (value[dep] === undefined) errors.push(`${dep}: obrigatório quando ${field} é informado`);
    }
  }
  for (const [field, pattern] of Object.entries(rules.patterns ?? {})) {
    if (value[field] !== undefined && !new RegExp(pattern).test(value[field])) {
      errors.push(`${field}: formato inválido (esperado ${pattern})`);
    }
  }
};

/** Retorna lista de erros (vazia = válido). */
export const validateToolInput = (tool, input) => {
  const errors = [];
  validateNode(tool.inputSchema, input, '', errors);
  if (errors.length === 0) validateLocalRules(tool.localRules, input, errors);
  return errors;
};
