# Security requirements

The static site can redirect casual visits to `/api/`, mark routes as `noindex`, and send a best-effort access audit event. Those measures are not API security. The ngrok-backed service must enforce these controls itself:

- Allow browser requests only from `https://ocean-works.github.io` using strict CORS. CORS is not authentication.
- Require authenticated, short-lived server-side sessions or signed access tokens on every protected route.
- Reject requests without valid authentication before reading or mutating data.
- Validate `Origin` and `Referer` as additional signals, never as the only authorization check.
- Add rate limiting per IP, account, route, and guild; cap request bodies and response sizes.
- Treat `ngrok-skip-browser-warning` as harmless routing metadata, never as a security credential.
- Record access attempts server-side with timestamp, route, status, account ID when known, and a privacy-conscious client fingerprint.
- Handle `OPTIONS` preflight separately and never allow wildcard origins with credentials.
- Use HTTPS, rotate secrets, keep OAuth client secrets off this repository, and configure Discord OAuth with exact redirect URIs.
- Return generic errors to clients and keep detailed diagnostics in server logs.

The `/api/access-attempt` endpoint should accept only a small JSON payload, apply rate limits, avoid storing raw tokens, and return `204 No Content`.

## Operator security key

The operator panel expects the backend to provide these authenticated routes:

- `GET /api/operator/security/status` returns `{ "verified": true|false }`.
- `POST /api/operator/security/request` generates a cryptographically random, single-use key, sends it by Discord DM to the authorized operator, and enforces a three-day rotation window.
- `POST /api/operator/security/verify` accepts `{ "key": "..." }`, verifies it server-side, expires it after use or timeout, and returns `{ "verified": true }`.

The generated key format is `oceanworks-{recipient}-{finalHuli}`. The backend must build a canonical payload containing the authenticated Discord user ID, issue timestamp, expiry timestamp, nonce, and rotation version; sign it with an HMAC-SHA-256 server secret; then encode the complete payload plus signature as the final HULI segment. HULI is base-15 using digits `0-9` and letters `A-E`. The older random/time pieces may be included inside the signed payload, but must not be trusted unless the signature verifies.

The backend must bind the key to the authenticated Discord user ID, send the DM through Discord, store only a hash or keyed MAC of the complete key, never expose the key in an API response, rate-limit requests and attempts, and reject operator commands until verification succeeds. Verification must decode HULI, validate the HMAC with constant-time comparison, check user binding and expiry, and invalidate the nonce after successful use. Do not use frontend JavaScript to generate, encrypt, decode, or validate the final key. The browser preview bypasses this only on local development hosts with `?dev=1`.
