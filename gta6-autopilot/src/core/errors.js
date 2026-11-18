// Erros tipados dos adaptadores (ViceScale, Cut.Pro). ViceScaleError é a base
// histórica de todos. `retryable` diz se o adaptador pode repetir a
// chamada com segurança; `alert` sinaliza que o painel deve exibir alerta.

export class ViceScaleError extends Error {
  constructor(message, { code, retryable = false, alert = false, cause, details } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code ?? 'VICESCALE_ERROR';
    this.retryable = retryable;
    this.alert = alert;
    this.details = details;
  }
}

export class ValidationError extends ViceScaleError {
  constructor(tool, problems) {
    super(`Parâmetros inválidos para "${tool}": ${problems.join('; ')}`, { code: 'VALIDATION', details: problems });
  }
}

export class UnknownToolError extends ViceScaleError {
  constructor(tool) {
    super(`Ferramenta "${tool}" não existe no catálogo ViceScale descoberto.`, { code: 'UNKNOWN_TOOL' });
  }
}

export class CapabilityUnavailableError extends ViceScaleError {
  constructor(capability, { reason, alternative }) {
    super(`Capacidade "${capability}" indisponível via MCP ViceScale: ${reason}`, {
      code: 'CAPABILITY_UNAVAILABLE',
      details: { reason, alternative },
    });
    this.alternative = alternative;
  }
}

export class AuthError extends ViceScaleError {
  constructor(message, cause) {
    super(message, { code: 'AUTH', alert: true, cause });
  }
}

export class TransientError extends ViceScaleError {
  constructor(message, cause, { retryAfterMs = 0, code = 'TRANSIENT' } = {}) {
    super(message, { code, retryable: true, cause });
    this.retryAfterMs = retryAfterMs;
  }
}

/** Erro de negócio devolvido por uma API REST ({ code, extra }). Não é repetido automaticamente. */
export class ApiError extends ViceScaleError {
  constructor(operation, status, code, extra) {
    super(`${operation} falhou (HTTP ${status}, ${code})`, { code, details: extra });
    this.status = status;
    this.extra = extra;
  }
}

/** O servidor recebeu a chamada e respondeu com isError. Nunca repetir automaticamente. */
export class ToolError extends ViceScaleError {
  constructor(tool, message) {
    super(`ViceScale recusou "${tool}": ${message}`, { code: 'TOOL_ERROR' });
  }
}

export class BlockedOperationError extends ViceScaleError {
  constructor(message, reason) {
    super(message, { code: 'BLOCKED', details: { reason } });
    this.reason = reason;
  }
}

export class QuotaExceededError extends ViceScaleError {
  constructor(bucket, limit) {
    super(`Limite diário interno de "${bucket}" atingido (${limit}).`, { code: 'QUOTA', alert: true });
  }
}

export class DuplicateOperationError extends ViceScaleError {
  constructor(key, state) {
    super(`Operação com chave "${key}" já existe (estado: ${state}).`, { code: 'DUPLICATE', details: { state } });
  }
}
