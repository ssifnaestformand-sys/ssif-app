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

// ── Auth — service account er påkrævet (fix H-3: auth springes ikke over) ────
$bearerToken = bearer_token();
if (!$bearerToken) {
    http_response_code(401); echo json_encode(['error' => 'Log ind i backoffice for at uploade']); exit;
}

$saPath = __DIR__ . '/firebase-service-account.json';
if (!file_exists($saPath)) {
    http_response_code(500); echo json_encode(['error' => 'Service account mangler']); exit;
}
$sa        = json_decode(file_get_contents($saPath), true);
$projectId = $sa['project_id'] ?? '';
if (!$projectId || !verify_firebase_id_token($bearerToken, $projectId)) {
    http_response_code(401); echo json_encode(['error' => 'Uautoriseret']); exit;
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

$allowed = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/gif' => 'gif', 'image/webp' => 'webp'];
if (!isset($allowed[$mime])) {
    http_response_code(400); echo json_encode(['error' => 'Kun JPEG, PNG, GIF og WebP er tilladt']); exit;
}

// ── Gem filen ─────────────────────────────────────────────────────────────────
// Uploads-mappen er én niveau op fra api/ og et niveau ned i uploads/
// dvs. app/uploads/  →  https://app.sejssvejbaek-if.dk/uploads/<filnavn>
$uploadDir = __DIR__ . '/../uploads/';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}

$ext      = $allowed[$mime];
$filename = uniqid('img_', true) . '.' . $ext;
$dest     = $uploadDir . $filename;

if (!move_uploaded_file($file['tmp_name'], $dest)) {
    http_response_code(500); echo json_encode(['error' => 'Kunne ikke gemme filen på serveren']); exit;
}

// ── Byg public URL ────────────────────────────────────────────────────────────
// Filen er tilgængelig på https://app.sejssvejbaek-if.dk/uploads/<filnavn>
$baseUrl  = 'https://app.sejssvejbaek-if.dk/uploads/';
$publicUrl = $baseUrl . $filename;

echo json_encode(['url' => $publicUrl, 'filename' => $filename], JSON_UNESCAPED_UNICODE);
