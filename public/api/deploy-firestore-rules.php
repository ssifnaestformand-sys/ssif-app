<?php
/**
 * Engangsbrug: Deployer Firestore Security Rules via service account.
 * SLET DENNE FIL FRA SERVEREN NÅR REGLERNE ER DEPLOYET.
 *
 * Kald: GET /api/deploy-firestore-rules.php?secret=ssif-deploy-2026
 */

if (($_GET['secret'] ?? '') !== 'ssif-deploy-2026') {
    http_response_code(403); echo 'Forbudt'; exit;
}

header('Content-Type: text/plain; charset=utf-8');

$saPath = __DIR__ . '/firebase-service-account.json';
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'];

// ── Hjælpefunktioner ──────────────────────────────────────────────────────────

function dr_b64u(string $d): string {
    return rtrim(strtr(base64_encode($d), '+/', '-_'), '=');
}

function dr_token(array $sa, string $scope): string {
    $now = time();
    $h   = dr_b64u(json_encode(['alg' => 'RS256', 'typ' => 'JWT']));
    $p   = dr_b64u(json_encode([
        'iss' => $sa['client_email'], 'scope' => $scope,
        'aud' => 'https://oauth2.googleapis.com/token',
        'iat' => $now, 'exp' => $now + 3600,
    ]));
    openssl_sign("$h.$p", $sig, $sa['private_key'], OPENSSL_ALGO_SHA256);
    $jwt  = "$h.$p." . dr_b64u($sig);
    $resp = @file_get_contents('https://oauth2.googleapis.com/token', false, stream_context_create(['http' => [
        'method'  => 'POST',
        'header'  => "Content-Type: application/x-www-form-urlencoded\r\n",
        'content' => http_build_query(['grant_type' => 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion' => $jwt]),
        'timeout' => 10, 'ignore_errors' => true,
    ]]));
    return json_decode($resp ?: '', true)['access_token'] ?? '';
}

// ── Firestore Security Rules ──────────────────────────────────────────────────

$rules = <<<'RULES'
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSignedIn() {
      return request.auth != null;
    }
    function isOwner(uid) {
      return isSignedIn() && request.auth.uid == uid;
    }
    function isAdmin() {
      return isSignedIn() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }
    function isTrainerOrAdmin() {
      return isSignedIn() &&
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role in ['admin', 'trainer'];
    }

    match /users/{uid} {
      allow read:  if isOwner(uid) || isAdmin();
      allow write: if isOwner(uid) || isAdmin();
    }

    match /holds/{holdId} {
      allow read:  if isSignedIn();
      allow write: if isTrainerOrAdmin();
    }

    match /members/{memberId} {
      allow read:  if isSignedIn();
      allow write: if isAdmin();
    }

    match /messages/{msgId} {
      allow read:   if isSignedIn();
      allow create: if isTrainerOrAdmin();
      allow update: if isSignedIn();
      allow delete: if isTrainerOrAdmin();
    }

    match /news/{newsId} {
      allow read:  if isSignedIn();
      allow write: if isTrainerOrAdmin();
    }

    match /events/{eventId} {
      allow read:   if isSignedIn();
      allow create: if isTrainerOrAdmin();
      allow update: if isTrainerOrAdmin();
      allow delete: if isTrainerOrAdmin();
    }

    match /banners/{bannerId} {
      allow read:  if isSignedIn();
      allow write: if isAdmin();
    }

    match /settings/{settingId} {
      allow read:  if isSignedIn();
      allow write: if isAdmin();
    }

    match /support/{supportId} {
      allow read:   if isSignedIn();
      allow create: if isSignedIn();
      allow update: if isAdmin();
      allow delete: if isAdmin();
    }

    match /conventus_pending/{token} {
      allow read:  if true;
      allow write: if false;
    }
  }
}
RULES;

// ── Deploy ────────────────────────────────────────────────────────────────────

$token = dr_token($sa, 'https://www.googleapis.com/auth/cloud-platform');
if (!$token) { echo "FEJL: Kunne ikke hente access token\n"; exit; }
echo "Token hentet\n";

$base = "https://firebasesecurity.googleapis.com/v1beta1/projects/{$projectId}";

// 1. Opret ruleset
$rulesetBody = json_encode(['source' => ['files' => [['name' => 'firestore.rules', 'content' => $rules]]]]);
$rulesetResp = @file_get_contents("{$base}/rulesets", false, stream_context_create(['http' => [
    'method'  => 'POST',
    'header'  => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
    'content' => $rulesetBody, 'timeout' => 15, 'ignore_errors' => true,
]]));
$ruleset = json_decode($rulesetResp ?: '', true);
if (!isset($ruleset['name'])) {
    echo "FEJL ved ruleset: " . substr($rulesetResp, 0, 500) . "\n"; exit;
}
echo "Ruleset oprettet: {$ruleset['name']}\n";

// 2. Opret eller opdater release
$releaseName = "projects/{$projectId}/releases/cloud.firestore";
$releaseBody = json_encode(['name' => $releaseName, 'rulesetName' => $ruleset['name']]);

$releaseResp = @file_get_contents("{$base}/releases", false, stream_context_create(['http' => [
    'method'  => 'POST',
    'header'  => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
    'content' => $releaseBody, 'timeout' => 15, 'ignore_errors' => true,
]]));
$release = json_decode($releaseResp ?: '', true);

if (isset($release['error']['status']) && $release['error']['status'] === 'ALREADY_EXISTS') {
    // Patch eksisterende release
    $patchResp = @file_get_contents("{$base}/releases/cloud.firestore", false, stream_context_create(['http' => [
        'method'  => 'PATCH',
        'header'  => "Authorization: Bearer {$token}\r\nContent-Type: application/json\r\n",
        'content' => json_encode(['release' => ['name' => $releaseName, 'rulesetName' => $ruleset['name']], 'updateMask' => 'rulesetName']),
        'timeout' => 15, 'ignore_errors' => true,
    ]]));
    $patch = json_decode($patchResp ?: '', true);
    if (isset($patch['name'])) {
        echo "✅ Firestore Security Rules deployet (opdateret)!\n";
        echo "HUSK: Slet denne fil fra serveren!\n";
    } else {
        echo "FEJL ved patch: " . substr($patchResp, 0, 500) . "\n";
    }
} elseif (isset($release['name'])) {
    echo "✅ Firestore Security Rules deployet!\n";
    echo "HUSK: Slet denne fil fra serveren!\n";
} else {
    echo "FEJL ved release: " . substr($releaseResp, 0, 500) . "\n";
}
