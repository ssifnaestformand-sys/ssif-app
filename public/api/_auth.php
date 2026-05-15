<?php
/**
 * Delt Firebase-autentificering til interne API-endpoints.
 *
 * Inkludér med:  require_once __DIR__ . '/_auth.php';
 *
 * Brug:
 *   $token = bearer_token();
 *   if ($token && verify_firebase_id_token($token, $projectId)) { ... }
 */

/**
 * Returnerer Bearer-token fra Authorization-headeren, eller tom streng.
 *
 * Apache på shared hosting (fx one.com) stripper Authorization-headeren.
 * .htaccess-reglen `RewriteRule ^ - [E=HTTP_AUTHORIZATION:...]` sætter
 * den tilbage i $_SERVER. Vi prøver alle kendte varianter som fallback.
 */
function bearer_token(): string {
    // Forsøg alle kendte steder Apache/PHP kan placere headeren
    $h = $_SERVER['HTTP_AUTHORIZATION']
      ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
      ?? '';

    // Sidst udvej: getallheaders() virker på nogle Apache-konfigurationer
    if (!$h && function_exists('getallheaders')) {
        $all = getallheaders();
        $h   = $all['Authorization'] ?? $all['authorization'] ?? '';
    }

    return (strpos($h, 'Bearer ') === 0) ? trim(substr($h, 7)) : '';
}

/**
 * Verificerer et Firebase ID-token via Googles offentlige certifikater.
 * Kræver ingen API-nøgle — bruger standard JWT-signaturverifikation.
 *
 * @param string $idToken   Firebase ID-token fra klientens getIdToken()
 * @param string $projectId Firebase project ID (fra service account)
 */
function verify_firebase_id_token(string $idToken, string $projectId): bool {
    $parts = explode('.', $idToken);
    if (count($parts) !== 3) return false;

    $header  = json_decode(base64url_dec($parts[0]), true);
    $payload = json_decode(base64url_dec($parts[1]), true);
    if (!$header || !$payload) return false;

    // Grundlæggende claim-tjek
    $now = time();
    if (($payload['exp'] ?? 0) < $now)  return false;
    if (($payload['iat'] ?? 0) > $now + 60) return false;
    if (($payload['aud'] ?? '') !== $projectId) return false;
    if (($payload['iss'] ?? '') !== "https://securetoken.google.com/{$projectId}") return false;
    if (empty($payload['sub'])) return false;

    // Hent Googles offentlige certifikater (kort cache-TTL, maks 1 HTTP-kald per request)
    $certsUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
    $certsRaw = @file_get_contents($certsUrl, false, stream_context_create([
        'http' => ['timeout' => 5, 'ignore_errors' => true],
    ]));
    if (!$certsRaw) return false;

    $certs = json_decode($certsRaw, true);
    $kid   = $header['kid'] ?? '';
    if (!isset($certs[$kid])) return false;

    // Verifikér JWT-signatur
    $pubKey   = openssl_get_publickey($certs[$kid]);
    $unsigned = $parts[0] . '.' . $parts[1];
    $sig      = base64url_dec($parts[2]);

    return openssl_verify($unsigned, $sig, $pubKey, OPENSSL_ALGO_SHA256) === 1;
}

function base64url_dec(string $d): string {
    return base64_decode(strtr($d, '-_', '+/') . str_repeat('=', (4 - strlen($d) % 4) % 4));
}
