<?php
/**
 * Billedupload til webhotellet.
 *
 * POST multipart/form-data med feltet "image" (fil) og "idToken" (Firebase auth).
 * Kræver at uploaderen er logget ind i backoffice.
 *
 * Returnerer: { "url": "https://app.sejssvejbaek-if.dk/uploads/<filnavn>" }
 *
 * Filer gemmes i /uploads/ relativt til app-roden.
 * FTP-deployen sletter ikke eksisterende filer, så billeder overlever redeploys.
 */

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
require_once __DIR__ . '/_auth.php';
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

// ── Auth via trainer_auth() — verificerer Firebase-token og members-collection ─
// Accepterer admin (users.isAdmin / users.role='admin') OG trænere/ledere
// (members.isLeder=true). Afhænger ikke af den udfasede users.role='trainer'.
$auth      = trainer_auth();
$uid       = $auth['uid'];
$fsToken   = $auth['fsToken'];
$projectId = $auth['projectId'];
$base      = $auth['base'];

// Tillad admin-flag fra users-collection (backoffice) eller isLeder fra members (trænere)
$userDoc = fs_get("{$base}/users/{$uid}", $fsToken);
$role    = $userDoc['fields']['role']['stringValue']    ?? '';
$isAdmin = $userDoc['fields']['isAdmin']['booleanValue']?? false;
if (!$isAdmin && $role !== 'admin' && $role !== 'trainer') {
    $email  = $auth['email'];
    $erLeder = false;
    if ($email) {
        $mRows = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
            'from'  => [['collectionId' => 'members']],
            'where' => ['fieldFilter' => ['field' => ['fieldPath' => 'allEmails'], 'op' => 'ARRAY_CONTAINS', 'value' => ['stringValue' => $email]]],
            'limit' => 1,
        ]]);
        foreach ($mRows as $mr) {
            if ($mr['document']['fields']['isLeder']['booleanValue'] ?? false) { $erLeder = true; break; }
        }
    }
    if (!$erLeder) {
        http_response_code(403);
        echo json_encode(['error' => 'Adgang nægtet — kræver admin- eller træner-rolle']);
        exit;
    }
}

// ── Validér fil ───────────────────────────────────────────────────────────────
if (empty($_FILES['image']) || $_FILES['image']['error'] !== UPLOAD_ERR_OK) {
    $phpErr = $_FILES['image']['error'] ?? -1;
    http_response_code(400);
    echo json_encode(['error' => 'Ingen fil modtaget (PHP fejlkode ' . $phpErr . ')']);
    exit;
}

$file     = $_FILES['image'];
$maxBytes = 10 * 1024 * 1024; // 10 MB

if ($file['size'] > $maxBytes) {
    http_response_code(400); echo json_encode(['error' => 'Fil for stor (maks 10 MB)']); exit;
}

// Tjek MIME-type via finfo (ikke kun browser-angivelse)
$finfo = finfo_open(FILEINFO_MIME_TYPE);
$mime  = finfo_file($finfo, $file['tmp_name']);
finfo_close($finfo);

$allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp', 'application/pdf' => 'pdf'];
if (!isset($allowed[$mime])) {
    http_response_code(400); echo json_encode(['error' => 'Kun JPEG, PNG, GIF, WebP og PDF er tilladt']); exit;
}

// ── Gem filen ─────────────────────────────────────────────────────────────────
// Uploads-mappen er én niveau op fra api/ og et niveau ned i uploads/
// dvs. app/uploads/  →  https://app.sejssvejbaek-if.dk/uploads/<filnavn>
$uploadDir = __DIR__ . '/../uploads/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

$ext      = $allowed[$mime];
$prefix   = $mime === 'application/pdf' ? 'doc_' : 'img_';
$filename = uniqid($prefix, true) . '.' . $ext;
$dest     = $uploadDir . $filename;

if (!move_uploaded_file($file['tmp_name'], $dest)) {
    http_response_code(500); echo json_encode(['error' => 'Kunne ikke gemme filen på serveren']); exit;
}

// ── Byg public URL ────────────────────────────────────────────────────────────
// Filen er tilgængelig på https://app.sejssvejbaek-if.dk/uploads/<filnavn>
$baseUrl  = 'https://app.sejssvejbaek-if.dk/uploads/';
$publicUrl = $baseUrl . $filename;

echo json_encode(['url' => $publicUrl, 'filename' => $filename], JSON_UNESCAPED_UNICODE);
