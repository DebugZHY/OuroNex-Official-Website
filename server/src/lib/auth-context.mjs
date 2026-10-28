/**
 * Request -> user identity seam.
 *
 * Two identity paths, in this order: the development header (only outside production, only with
 * AUTH_DEV_MODE=on) and a real Stack Auth session verified against the Stack Auth API. A request
 * that presents neither resolves to { userId: null } with a reason that says which check failed —
 * no caller ever sees a default or fallback user.
 *
 * Environment is read per request (never cached at import time) so a process can switch modes
 * between calls — the acceptance probes rely on that.
 */

/** Identity paths this seam knows about. Callers can report which one is live. */
export const IDENTITY_MODES = Object.freeze(['stack', 'dev_header', 'unconfigured']);

export const DEV_USER_HEADER = 'x-ouronex-dev-user';

/** Conservative user-id shape: Stack user ids are uuids, but any opaque token is acceptable. */
const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;

function headerOf(req, name) {
  if (!req || typeof req.get !== 'function') return undefined;
  const value = req.get(name);
  return typeof value === 'string' ? value : undefined;
}

/**
 * EXTENSION POINT — Stack Auth session verification.
 *
 * Reads the session credential, asks the Stack Auth REST API who it belongs to, and returns that
 * user id. The token is never decoded or trusted locally: only the API answer counts, so a forged
 * or expired token cannot become an identity, and a token minted for another project is rejected by
 * the API itself (`INVALID_PROJECT_FOR_ACCESS_TOKEN`).
 *
 * Configuration is read per call (not captured at import) so a process can be pointed at a different
 * project without a restart, and so the probes can walk the configured/unconfigured cases in one
 * process. Missing configuration is reported, never guessed: an unconfigured deployment cannot
 * authenticate anyone, which is the safe direction.
 *
 * The identity of the user is `id` from the API response; the email is passed through only for
 * logging/display and is not part of the decision.
 */
export function resolveStackConfig(source = process.env) {
  const baseUrl = (source.NEXT_PUBLIC_STACK_API_URL || '').trim().replace(/\/+$/, '');
  const projectId = (source.HEXCLAVE_PROJECT_ID || '').trim();
  const secretServerKey = (source.HEXCLAVE_SECRET_SERVER_KEY || '').trim();
  if (!baseUrl || !projectId || !secretServerKey) {
    return { configured: false, missing: [
      !baseUrl && 'NEXT_PUBLIC_STACK_API_URL',
      !projectId && 'HEXCLAVE_PROJECT_ID',
      !secretServerKey && 'HEXCLAVE_SECRET_SERVER_KEY',
    ].filter(Boolean) };
  }
  return { configured: true, baseUrl, projectId, secretServerKey };
}

const STACK_LOOKUP_TIMEOUT_MS = 5000;

/** Bearer token from `authorization`, or the raw `x-stack-access-token`. */
function presentedToken(req) {
  const authorization = (headerOf(req, 'authorization') || '').trim();
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization);
    if (match) return match[1].trim();
    return null; // an Authorization header of another scheme is not a Stack Auth session
  }
  const direct = (headerOf(req, 'x-stack-access-token') || '').trim();
  return direct || null;
}

export async function resolveStackUserId(req) {
  const token = presentedToken(req);
  if (!token) return { userId: null, reason: 'stack_no_credential' };

  const config = resolveStackConfig();
  if (!config.configured) {
    return { userId: null, reason: 'stack_auth_not_configured', missing: config.missing };
  }

  let response;
  try {
    response = await fetch(`${config.baseUrl}/api/v1/users/me`, {
      method: 'GET',
      headers: {
        'x-stack-project-id': config.projectId,
        'x-stack-secret-server-key': config.secretServerKey,
        'x-stack-access-type': 'server',
        'x-stack-access-token': token,
      },
      signal: AbortSignal.timeout(STACK_LOOKUP_TIMEOUT_MS),
    });
  } catch (error) {
    // Timeout or transport failure: an unreachable auth backend must not authenticate anyone.
    return { userId: null, reason: 'stack_lookup_failed', detail: error && error.name };
  }

  if (response.status === 401 || response.status === 403) {
    return { userId: null, reason: 'stack_session_invalid' };
  }
  if (!response.ok) {
    return { userId: null, reason: 'stack_lookup_failed', detail: `http_${response.status}` };
  }

  let body;
  try {
    body = await response.json();
  } catch {
    return { userId: null, reason: 'stack_lookup_failed', detail: 'malformed_response' };
  }
  const userId = typeof body?.id === 'string' ? body.id.trim() : '';
  if (!USER_ID_PATTERN.test(userId)) {
    return { userId: null, reason: 'stack_lookup_failed', detail: 'missing_user_id' };
  }
  return { userId, email: body.primary_email ?? null, reason: 'ok' };
}

/**
 * Resolve the caller's user id.
 *
 * @param {import('express').Request} req
 * @returns {Promise<{userId: string|null, mode: 'stack'|'dev_header'|'unconfigured', reason: string}>}
 */
export async function resolveUserId(req) {
  const isProduction = process.env.NODE_ENV === 'production';
  const devModeOn = process.env.AUTH_DEV_MODE === 'on';

  // Production refuses the development header even when AUTH_DEV_MODE is on.
  if (isProduction && devModeOn) {
    return { userId: null, mode: 'unconfigured', reason: 'dev_mode_refused_in_production' };
  }

  if (!isProduction && devModeOn) {
    const candidate = (headerOf(req, DEV_USER_HEADER) || '').trim();
    if (!candidate) {
      return { userId: null, mode: 'unconfigured', reason: 'dev_mode_on_without_header' };
    }
    if (!USER_ID_PATTERN.test(candidate)) {
      return { userId: null, mode: 'unconfigured', reason: 'malformed_dev_header' };
    }
    return { userId: candidate, mode: 'dev_header', reason: 'ok' };
  }

  const stack = await resolveStackUserId(req);
  if (stack.userId) {
    return { userId: stack.userId, mode: 'stack', reason: 'ok' };
  }
  return { userId: null, mode: 'unconfigured', reason: stack.reason };
}

export default { resolveUserId, resolveStackUserId, resolveStackConfig, IDENTITY_MODES, DEV_USER_HEADER };