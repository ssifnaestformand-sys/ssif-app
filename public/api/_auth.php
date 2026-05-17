<?php
/**
 * Delt Firebase-autentificering og sikkerhedshjælpere.
 */

// ── CORS ────────────────────────────────────────────────────────────────────
// Tillader kun kendte app-domæner. Wildcard (*) fjernet.
function set_cors_headers(): void {
    $origin  = $_SERVER['HTTP_ORIGIN'] ?? '';
    $allowed = ['https://app.sejssvejbaek-if.dk', 'https://www.sejssvejbaek-if.dk'];
    $out     = in_array($origin, $allowed, true) ? $origin : 'https://app.sejssvejbaek-if.dk';
    header("Access-Control-Allow-Origin: {$out}");
    header('Vary: Origin');
}

// ── Bearer-token ──────────────────────────────────────────────────────────────
// Læser Firebase ID-token fra: 1) Authorization-header, 2) JSON-body, 3) POST-felt
function bearer_token(): string {
    static $cached = null;
    if ($cached !== null) return $cached;

    $h = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    if (!$h && function_exists('getallheaders')) {
        $all = getallheaders();
        $h   = $all['Authorization'] ?? $all['authorization'] ?? '';
    }
    if (strpos($h, 'Bearer ') === 0) return $cached = trim(substr($h, 7));

    $raw  = file_get_contents('php://input');
    $body = $raw ? (json_decode($raw, true) ?: []) : [];
    if (!empty($body['idToken'])) return $cached = (string)$body['idToken'];

    return $cached = (string)($_POST['idToken'] ?? '');
}

// ── Google-certifikater (cachet på disk for at undgå live-kald pr. request) ───
function get_google_certs(): array {
    $cacheFile = sys_get_temp_dir() . '/ssif_firebase_certs.json';

    if (file_exists($cacheFile)) {
        $cached = json_decode(file_get_contents($cacheFile), true);
        if ($cached && ($cached['expires'] ?? 0) > time()) {
            return $cached['certs'];
        }
    }

    $certsUrl = 'https://www.googleapis.com/robot/v1/metadata/x509/'
              . 'securetoken@system.gserviceaccount.com';
    $certsRaw = @file_get_contents($certsUrl, false, stream_context_create([
        'http' => ['timeout' => 5, 'ignore_errors' => true],
    ]));
    if (!$certsRaw) {
        // Returner cachet version selvom udløbet — bedre end fejl
        return isset($cached['certs']) ? $cached['certs'] : [];
    }

    $certs  = json_decode($certsRaw, true) ?: [];
    $maxAge = 3600;
    foreach ($http_response_header ?? [] as $hdr) {
        if (stripos($hdr, 'Cache-Control:') !== false
            && preg_match('/max-age=(\d+)/i', $hdr, $m)) {
            $maxAge = (int)$m[1]; break;
        }
    }
    @file_put_contents($cacheFile, json_encode(['expires' => time() + $maxAge, 'certs' => $certs]));
    return $certs;
}

// ── JWT-signaturverifikation ──────────────────────────────────────────────────
function verify_firebase_id_token(string $idToken, string $projectId): bool {
    $parts = explode('.', $idToken);
    if (count($parts) !== 3) return false;

    $header  = json_decode(base64url_dec($parts[0]), true);
    $payload = json_decode(base64url_dec($parts[1]), true);
    if (!$header || !$payload) return false;

    $now = time();
    if (($payload['exp'] ?? 0) < $now)  return false;
    if (($payload['iat'] ?? 0) > $now + 60) return false;
    if (($payload['aud'] ?? '') !== $projectId) return false;
    if (($payload['iss'] ?? '') !== "https://securetoken.google.com/{$projectId}") return false;
    if (empty($payload['sub'])) return false;

    $certs = get_google_certs();
    $kid   = $header['kid'] ?? '';
    if (!isset($certs[$kid])) return false;

    $pubKey   = openssl_get_publickey($certs[$kid]);
    $unsigned = $parts[0] . '.' . $parts[1];
    $sig      = base64url_dec($parts[2]);

    return openssl_verify($unsigned, $sig, $pubKey, OPENSSL_ALGO_SHA256) === 1;
}

// ── Udtræk UID fra allerede-verificeret token ─────────────────────────────────
function uid_from_token(string $idToken): string {
    $parts = explode('.', $idToken);
    if (count($parts) !== 3) return '';
    $payload = json_decode(base64url_dec($parts[1]), true);
    return (string)($payload['sub'] ?? $payload['user_id'] ?? '');
}

// ── Rolle-tjek via Firestore REST ─────────────────────────────────────────────
// Verificerer at den autentificerede bruger har rollen 'admin' eller 'trainer'.
// Terminerer med HTTP 403 ved manglende adgang.
function require_role(string $uid, string $projectId, string $accessToken, array $allowed = ['admin', 'trainer']): void {
    $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}"
          . "/databases/(default)/documents/users/{$uid}";
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'GET',
        'header'        => "Authorization: Bearer {$accessToken}\r\n",
        'timeout'       => 5,
        'ignore_errors' => true,
    ]]));
    if (!$resp) {
        http_response_code(503);
        echo json_encode(['error' => 'Kunne ikke verificere brugerrolle']);
        exit;
    }
    $data = json_decode($resp, true);
    $role = $data['fields']['role']['stringValue'] ?? '';
    if (!in_array($role, $allowed, true)) {
        http_response_code(403);
        echo json_encode(['error' => 'Adgang nægtet — kræver admin- eller træner-rolle']);
        exit;
    }
}

function base64url_dec(string $d): string {
    return base64_decode(strtr($d, '-_', '+/') . str_repeat('=', (4 - strlen($d) % 4) % 4));
}
