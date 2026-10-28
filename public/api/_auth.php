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

// ── Firestore REST-hjælpere (bruges af træner-endpoints) ──────────────────────

function make_fs_token(array $sa): string {
    $now = time();
    $h   = rtrim(strtr(base64_encode(json_encode(['alg' => 'RS256', 'typ' => 'JWT'])), '+/', '-_'), '=');
    $p   = rtrim(strtr(base64_encode(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/datastore',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ])), '+/', '-_'), '=');
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . rtrim(strtr(base64_encode($sig), '+/', '-_'), '=');
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content'       => http_build_query([
            'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            'assertion'  => $jwt,
        ]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}

function decode_token_payload(string $idToken): array {
    $parts = explode('.', $idToken);
    if (count($parts) !== 3) return [];
    return json_decode(base64url_dec($parts[1]), true) ?? [];
}

function fs_get(string $url, string $token): ?array {
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'GET',
        'header'        => "Authorization: Bearer {$token}\r\n",
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return null;
    $data = json_decode($resp, true);
    return isset($data['fields']) ? $data : null;
}

function fs_run_query(string $projectId, string $token, array $query): array {
    $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:runQuery";
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode($query),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return [];
    return json_decode($resp, true) ?? [];
}

function fs_list(string $url, string $token, int $pageSize = 100): array {
    $allDocs   = [];
    $pageToken = '';
    do {
        $fetchUrl = $url . '?pageSize=' . $pageSize . ($pageToken ? '&pageToken=' . urlencode($pageToken) : '');
        $resp = @file_get_contents($fetchUrl, false, stream_context_create(['http' => [
            'method'        => 'GET',
            'header'        => "Authorization: Bearer {$token}\r\n",
            'timeout'       => 10,
            'ignore_errors' => true,
        ]]));
        if (!$resp) break;
        $data      = json_decode($resp, true);
        $allDocs   = array_merge($allDocs, $data['documents'] ?? []);
        $pageToken = $data['nextPageToken'] ?? '';
    } while ($pageToken !== '');
    return $allDocs;
}

function fs_commit(string $projectId, string $token, array $writes): bool {
    $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents:commit";
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['writes' => $writes]),
        'timeout'       => 15,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return false;
    $data = json_decode($resp, true);
    return !isset($data['error']);
}

function fs_create(string $projectId, string $token, string $collection, array $fields): ?string {
    $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents/{$collection}";
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'POST',
        'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => $fields]),
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return null;
    $data = json_decode($resp, true);
    return isset($data['name']) ? basename($data['name']) : null;
}

// Finder alle lederHolds for brugeren på tværs af alle matchende member-profiler.
// Returnerer ['holdId' => true, ...], eller [] hvis ingen.
function get_leder_holds(string $email, string $conventus_id, string $projectId, string $fsToken): array {
    $base       = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";
    $memberDocs = [];

    if ($conventus_id !== '') {
        $doc = fs_get("{$base}/members/{$conventus_id}", $fsToken);
        if ($doc) $memberDocs[$conventus_id] = $doc['fields'];
    }
    if ($email !== '') {
        $rows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
            'from'  => [['collectionId' => 'members']],
            'where' => ['fieldFilter' => [
                'field' => ['fieldPath' => 'allEmails'],
                'op'    => 'ARRAY_CONTAINS',
                'value' => ['stringValue' => $email],
            ]],
        ]]);
        foreach ($rows as $row) {
            if (!isset($row['document']['fields'])) continue;
            $docId = basename($row['document']['name'] ?? '');
            if ($docId) $memberDocs[$docId] = $row['document']['fields'];
        }
    }

    $lederHoldIds = [];
    foreach ($memberDocs as $fields) {
        foreach ($fields['lederHolds']['arrayValue']['values'] ?? [] as $v) {
            $id = (string)($v['integerValue'] ?? $v['stringValue'] ?? '');
            if ($id !== '') $lederHoldIds[$id] = true;
        }
    }
    return $lederHoldIds;
}

// ── Testtilstand-konfiguration fra Firestore (settings/trainer_app) ───────────
// Konfigureres fra backoffice — ikke via env-vars.

function trainer_app_config(string $base, string $fsToken): array {
    static $cache = null;
    if ($cache !== null) return $cache;
    $doc = fs_get("{$base}/settings/trainer_app", $fsToken);
    $f   = $doc['fields'] ?? [];
    $cache = [
        'testMode'  => (bool)($f['testMode']['booleanValue'] ?? false),
        'testEmail' => $f['testEmail']['stringValue'] ?? '',
        'testPhone' => $f['testPhone']['stringValue'] ?? '',
    ];
    return $cache;
}

// Stubs bevaret så evt. direkte kald ikke bryder compilering.
function is_test_mode(): bool { return false; }
function test_email(): string { return ''; }
function test_phone(): string { return ''; }

// Standard auth-opsætning for træner-endpoints.
// Terminerer med HTTP 401/403/500 ved fejl. Returnerer auth-kontekst.
function trainer_auth(): array {
    $idToken = bearer_token();
    if (!$idToken) { http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit; }

    $saPath = __DIR__ . '/firebase-service-account.json';
    if (!file_exists($saPath)) { http_response_code(500); echo json_encode(['error' => 'Konfigurationsfejl']); exit; }
    $sa        = json_decode(file_get_contents($saPath), true);
    $projectId = $sa['project_id'];

    if (!verify_firebase_id_token($idToken, $projectId)) {
        http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit;
    }

    $payload      = decode_token_payload($idToken);
    $uid          = uid_from_token($idToken);
    $email_verified = $payload['email_verified'] ?? false;
    $raw_email    = strtolower(trim((string)($payload['email'] ?? '')));
    $conventus_id = trim((string)($payload['conventus_id'] ?? ''));

    if (!$uid) { http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit; }
    if ($raw_email !== '' && !$email_verified) {
        http_response_code(403); echo json_encode(['error' => 'email_not_verified']); exit;
    }
    $email = $email_verified ? $raw_email : '';

    $fsToken = make_fs_token($sa);
    if (!$fsToken) { http_response_code(500); echo json_encode(['error' => 'OAuth fejlede']); exit; }

    return [
        'uid'          => $uid,
        'email'        => $email,
        'conventus_id' => $conventus_id,
        'fsToken'      => $fsToken,
        'projectId'    => $projectId,
        // base: bruges som HTTP request-URL til Firestore REST-kald
        'base'         => "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents",
        // resourceBase: bruges som document-navn i batch commit (projects/…, uden https-præfix)
        'resourceBase' => "projects/{$projectId}/databases/(default)/documents",
    ];
}
