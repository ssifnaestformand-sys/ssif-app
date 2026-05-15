<?php
/**
 * Synkronisér Conventus-medlemmer til Firestore
 *
 * POST (ingen body nødvendig) med header:
 *   X-Sync-Secret: <SYNC_SECRET>
 *
 * Henter alle aktive medlemmer fra Conventus, udtrækker navn,
 * email, relationsemails (forældre) og holdtilknytning, og skriver
 * til Firestore members/{conventus_id}.
 *
 * PERSONFØLSOMME DATA:
 *   – Conventus API-nøglen håndteres udelukkende server-side
 *   – Endpointet kræver X-Sync-Secret autentificering
 *   – Persdata (navne, emails) eksponeres aldrig i HTTP-svaret
 *   – Svar indeholder kun tæller og tidsstempel
 *
 * Firestore security rules der anbefales for members-samlingen:
 *   match /members/{id} {
 *     allow read: if request.auth != null;
 *     allow write: if false;   // kun service account må skrive
 *   }
 *
 * Opsæt server-side cron (one.com kontrolpanel) for automatisk
 * synkronisering, fx hver time:
 *   0 * * * *  curl -s -X POST https://app.sejssvejbaek-if.dk/api/sync-members.php \
 *                -H "X-Sync-Secret: DIN_SYNC_SECRET"
 */

set_time_limit(300);
ini_set('memory_limit', '256M'); // Stor XML-fil fra Conventus kræver mere hukommelse

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: X-Sync-Secret');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

// ── Autentificering (kun server-til-server via cron/deploy) ──────────────────
$syncSecret = getenv('SYNC_SECRET') ?: '';
$sentSecret = $_SERVER['HTTP_X_SYNC_SECRET'] ?? '';
if (!$syncSecret || !hash_equals($syncSecret, $sentSecret)) {
    http_response_code(401);
    echo json_encode(['error' => 'Uautoriseret']);
    exit;
}

// ── Conventus API-nøgle (aldrig eksponeret i svar) ────────────────────────────
$apiKey = getenv('CONVENTUS_KEY') ?: '';
if (!$apiKey) {
    foreach ([__DIR__ . '/.env', __DIR__ . '/../../.env'] as $path) {
        if (file_exists($path)) {
            $env = parse_ini_file($path);
            if (!empty($env['CONVENTUS_KEY'])) { $apiKey = $env['CONVENTUS_KEY']; break; }
        }
    }
}
if (!$apiKey) {
    http_response_code(500);
    echo json_encode(['error' => 'CONVENTUS_KEY ikke konfigureret på serveren']);
    exit;
}

// ── Firebase service account ──────────────────────────────────────────────────
$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500);
    echo json_encode(['error' => 'Firebase service account mangler']);
    exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

$accessToken = google_access_token($sa);
if (!$accessToken) {
    http_response_code(500);
    echo json_encode(['error' => 'Kunne ikke autentificere med Firebase']);
    exit;
}

// ── Hent aktive hold fra Firestore (til aktiv_i_app-flag) ─────────────────────
$aktivHolds = fetch_aktiv_holds($projectId, $accessToken);

// ── Hent medlemmer fra Conventus ──────────────────────────────────────────────
$ctx = stream_context_create(['http' => ['timeout' => 60, 'ignore_errors' => true]]);
$membresUrl = 'https://www.conventus.dk/dataudv/api/adressebog/get_membres.php?' . http_build_query([
    'forening'   => '1031',
    'key'        => $apiKey,
    'relationer' => 'true',
]);

$raw = @file_get_contents($membresUrl, false, $ctx);
if ($raw === false) {
    http_response_code(503);
    echo json_encode(['error' => 'Ingen svar fra Conventus']);
    exit;
}

// Håndter ISO-8859-1 encoding (danske tegn)
if (preg_match('/encoding=["\']ISO-8859-1["\']/i', $raw)) {
    $raw = mb_convert_encoding($raw, 'UTF-8', 'ISO-8859-1');
    $raw = preg_replace('/encoding=["\']ISO-8859-1["\']/i', 'encoding="UTF-8"', $raw);
}

// Tjek at svaret ser ud som XML
if (strpos(ltrim($raw), '<') !== 0) {
    http_response_code(502);
    echo json_encode(['error' => 'Uventet svar fra Conventus (ikke XML)']);
    exit;
}

// ── Parse og skriv til Firestore (streaming for store filer) ──────────────────
$members    = parse_members_stream($raw, $aktivHolds);
$written    = 0;
$skipped    = 0;
$errCount   = 0;
$syncedAt   = date('c');

foreach ($members as $member) {
    $docId = (string)$member['conventus_id'];
    if (!$docId) { $skipped++; continue; }

    // Skriv ALDRIG navn/email i fejlbeskeder der returneres til klienten
    if (firestore_patch($projectId, $accessToken, "members/{$docId}", $member)) {
        $written++;
    } else {
        $errCount++;
    }
}

// Svar indeholder kun tæller — ingen persdata
echo json_encode([
    'ok'      => true,
    'written' => $written,
    'skipped' => $skipped,
    'errors'  => $errCount,
    'total'   => count($members),
    'synced'  => $syncedAt,
], JSON_UNESCAPED_UNICODE);

// ── Streaming XML-parser (XMLReader) ─────────────────────────────────────────
//
// simplexml_load_string() loader hele dokumentet til hukommelsen på én gang.
// For store Conventus-filer (mange hundrede membres) kan det overskride PHP's
// memory_limit på shared hosting.
//
// XMLReader + expand() streamer dokumentet og ekspanderer kun ét <kontakt>-
// element ad gangen til SimpleXMLElement — hukommelsesforbruget forbliver lavt
// uanset filstørrelse.

function parse_members_stream(string $raw, array $aktivHolds): array {
    libxml_use_internal_errors(true);

    $reader = new XMLReader();
    if (!$reader->XML($raw, 'UTF-8', LIBXML_NOERROR | LIBXML_NOWARNING)) {
        return [];
    }

    $members      = [];
    $kontaktDepth = -1; // sættes første gang vi finder et top-level <kontakt>

    while ($reader->read()) {
        if ($reader->nodeType !== XMLReader::ELEMENT) continue;

        $tag = strtolower($reader->localName);

        // Acceptér kontakt på depth 1 (direkte under root) ELLER depth 2
        // (under <kontakter>/<members>). Sæt depth første gang.
        if ($tag === 'kontakt') {
            $d = $reader->depth;
            if ($kontaktDepth < 0 && $d <= 2) $kontaktDepth = $d;
            if ($d !== $kontaktDepth) continue; // spring over nested relationer-kontakter

            $id = $reader->getAttribute('id') ?? '';
            if (!$id || !ctype_digit($id)) continue;

            // Ekspandér kun dette ene element — frigives af GC bagefter
            $domNode = $reader->expand();
            if (!$domNode) continue;

            $k = simplexml_import_dom($domNode);
            if (!$k) continue;

            $member = extract_member($k, (int)$id, $aktivHolds);
            if ($member) $members[] = $member;

            unset($k, $domNode);
        }
    }

    $reader->close();
    libxml_clear_errors();
    return $members;
}

function extract_member(SimpleXMLElement $k, int $id, array $aktivHolds): ?array {
    $fornavn   = trim((string)($k->fornavn   ?? $k->firstname ?? ''));
    $efternavn = trim((string)($k->efternavn  ?? $k->lastname  ?? ''));
    $name      = trim("$fornavn $efternavn") ?: 'Ukendt';
    $ownEmail  = strtolower(trim((string)($k->email ?? '')));

    // Relation-emails (forældre/værger)
    $relEmails = [];
    if (isset($k->relationer)) {
        foreach ($k->relationer->children() as $rel) {
            $re = strtolower(trim((string)($rel->email ?? '')));
            if ($re && filter_var($re, FILTER_VALIDATE_EMAIL)) $relEmails[] = $re;
        }
    }

    // Alle unikke, validerede emails
    $allEmails = [];
    if ($ownEmail && filter_var($ownEmail, FILTER_VALIDATE_EMAIL)) $allEmails[] = $ownEmail;
    foreach ($relEmails as $re) {
        if (!in_array($re, $allEmails, true)) $allEmails[] = $re;
    }
    if (empty($allEmails)) return null;

    // Holdtilknytning
    $holds    = [];
    $grupNode = $k->grupper ?? $k->hold ?? null;
    if ($grupNode) {
        foreach ($grupNode->children() as $g) {
            $holdId    = (int)($g['id'] ?? 0);
            $holdTitel = html_entity_decode(
                trim((string)($g['titel'] ?? $g['navn'] ?? $g)),
                ENT_HTML5 | ENT_QUOTES, 'UTF-8'
            );
            if (!$holdTitel && !empty((string)$g['titel'])) {
                $holdTitel = html_entity_decode((string)$g['titel'], ENT_HTML5 | ENT_QUOTES, 'UTF-8');
            }
            if ($holdId) {
                $holds[] = [
                    'conventus_id' => $holdId,
                    'titel'        => $holdTitel ?: "Hold #{$holdId}",
                    'aktiv_i_app'  => isset($aktivHolds[$holdId]),
                ];
            }
        }
    }

    return [
        'conventus_id' => $id,
        'name'         => $name,
        'allEmails'    => $allEmails,
        'holds'        => $holds,
    ];
}

// ── Firestore: hent aktive hold ───────────────────────────────────────────────

function fetch_aktiv_holds(string $projectId, string $token): array {
    $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}"
          . "/databases/(default)/documents/holds?pageSize=500";
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'header'        => "Authorization: Bearer {$token}\r\n",
        'timeout'       => 10,
        'ignore_errors' => true,
    ]]));
    if (!$resp) return [];

    $map = [];
    foreach ((json_decode($resp, true)['documents'] ?? []) as $doc) {
        $f = $doc['fields'] ?? [];
        if (($f['aktiv']['booleanValue'] ?? false) === true) {
            $id = (int)($f['conventus_id']['integerValue']
                     ?? $f['conventus_id']['doubleValue']
                     ?? 0);
            if ($id) $map[$id] = true;
        }
    }
    return $map;
}

// ── Firestore: skriv ét dokument (PATCH = upsert) ─────────────────────────────

function firestore_patch(string $projectId, string $token, string $path, array $data): bool {
    $fields = [];
    foreach ($data as $k => $v) $fields[$k] = to_fs($v);

    $url  = "https://firestore.googleapis.com/v1/projects/{$projectId}"
          . "/databases/(default)/documents/{$path}";
    $resp = @file_get_contents($url, false, stream_context_create(['http' => [
        'method'        => 'PATCH',
        'header'        => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
        'content'       => json_encode(['fields' => $fields]),
        'timeout'       => 15,
        'ignore_errors' => true,
    ]]));
    return $resp !== false && !empty(json_decode($resp, true)['fields']);
}

function to_fs($v): array {
    if (is_null($v))   return ['nullValue' => 'NULL_VALUE'];
    if (is_bool($v))   return ['booleanValue' => $v];
    if (is_int($v))    return ['integerValue' => (string)$v];
    if (is_float($v))  return ['doubleValue' => $v];
    if (is_string($v)) return ['stringValue' => $v];
    if (is_array($v)) {
        if (empty($v) || array_keys($v) === range(0, count($v) - 1)) {
            return ['arrayValue' => ['values' => array_map('to_fs', array_values($v))]];
        }
        $fields = [];
        foreach ($v as $k => $val) $fields[$k] = to_fs($val);
        return ['mapValue' => ['fields' => $fields]];
    }
    return ['stringValue' => (string)$v];
}

// ── Google OAuth 2.0 via service account ──────────────────────────────────────

function google_access_token(array $sa): string {
    $now    = time();
    $header = b64u(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $claims = b64u(json_encode([
        'iss'   => $sa['client_email'],
        'scope' => 'https://www.googleapis.com/auth/datastore',
        'aud'   => 'https://oauth2.googleapis.com/token',
        'iat'   => $now,
        'exp'   => $now + 3600,
    ]));
    $unsigned = "$header.$claims";
    openssl_sign($unsigned, $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt = "$unsigned." . b64u($sig);

    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false,
        stream_context_create(['http' => [
            'method'        => 'POST',
            'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
            'content'       => http_build_query([
                'grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                'assertion'  => $jwt,
            ]),
            'timeout'       => 10,
            'ignore_errors' => true,
        ]])
    );
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}

function b64u(string $d): string {
    return rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
}
