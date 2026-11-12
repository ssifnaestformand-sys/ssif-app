<?php
/**
 * Modtag en supporthenvendelse fra træner-appen.
 *
 * POST  Authorization: Bearer <Firebase ID-token>
 *       { question: "...", category: "..." }
 *
 * Skriver til Firestore-collection 'support' og sender mail til
 * alle brugere med supportNotify == true i users-collection.
 */

require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_send_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$auth        = trainer_auth();
$uid         = $auth['uid'];
$email       = $auth['email'];
$displayName = $auth['displayName'];
$fsToken     = $auth['fsToken'];
$projectId   = $auth['projectId'];

$body     = json_decode(file_get_contents('php://input'), true) ?? [];
$question = trim((string)($body['question'] ?? ''));
$category = trim((string)($body['category'] ?? 'Andet'));

if (!$question) { http_response_code(400); echo json_encode(['error' => 'Spørgsmål mangler']); exit; }

// ── Skriv til Firestore ───────────────────────────────────────────────────────
$docId = fs_create($projectId, $fsToken, 'support', [
    'question'    => ['stringValue'    => $question],
    'category'    => ['stringValue'    => $category],
    'authorName'  => ['stringValue'    => $displayName ?: $email],
    'authorEmail' => ['stringValue'    => $email],
    'authorUid'   => ['stringValue'    => $uid],
    'status'      => ['stringValue'    => 'afventer'],
    'source'      => ['stringValue'    => 'trainer-app'],
    'createdAt'   => ['timestampValue' => date('Y-m-d\TH:i:s\Z')],
]);

if (!$docId) {
    http_response_code(500);
    echo json_encode(['error' => 'Kunne ikke gemme henvendelse']);
    exit;
}

// ── Send mail til valgte administratorer ─────────────────────────────────────
$base  = "https://firestore.googleapis.com/v1/projects/{$projectId}/databases/(default)/documents";
$rows  = fs_run_query($projectId, $fsToken, ['structuredQuery' => [
    'from'  => [['collectionId' => 'users']],
    'where' => ['fieldFilter' => [
        'field' => ['fieldPath' => 'supportNotify'],
        'op'    => 'EQUAL',
        'value' => ['booleanValue' => true],
    ]],
]]);

$afsender  = $displayName ?: $email;
$subj      = "Ny supporthenvendelse fra {$afsender}";
$html      = byg_support_mail_html($afsender, $category, $question);

foreach ($rows as $row) {
    if (!isset($row['document']['fields'])) continue;
    $toEmail = '';
    foreach (['email', 'primaryEmail'] as $field) {
        $v = $row['document']['fields'][$field]['stringValue'] ?? '';
        if ($v && filter_var($v, FILTER_VALIDATE_EMAIL)) { $toEmail = $v; break; }
    }
    if ($toEmail) smtp_send_html($toEmail, $subj, $html, 'SSIF Trænerapp');
}

echo json_encode(['ok' => true, 'id' => $docId]);

// ── Mail-template ─────────────────────────────────────────────────────────────
function byg_support_mail_html(string $afsenderNavn, string $kategori, string $spørgsmaal): string {
    $navnEnc  = htmlspecialchars($afsenderNavn);
    $katEnc   = htmlspecialchars($kategori);
    $sprgEnc  = nl2br(htmlspecialchars($spørgsmaal));
    return <<<HTML
<!DOCTYPE html>
<html lang="da">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f4;font-family:system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table width="100%" style="max-width:480px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.08)">
  <tr><td style="background:#1a5c2a;padding:18px 24px">
    <p style="margin:0;color:#fff;font-size:18px;font-weight:800">&#9917; SSIF - Ny supporthenvendelse</p>
  </td></tr>
  <tr><td style="padding:24px">
    <p style="margin:0 0 6px;font-size:13px;color:#888">Fra</p>
    <p style="margin:0 0 16px;font-size:15px;font-weight:700;color:#1a1a1a">{$navnEnc}</p>
    <p style="margin:0 0 6px;font-size:13px;color:#888">Kategori</p>
    <p style="margin:0 0 16px;font-size:14px;color:#1a1a1a">{$katEnc}</p>
    <p style="margin:0 0 6px;font-size:13px;color:#888">Spørgsmål</p>
    <div style="background:#f4f6f4;border-left:3px solid #1a5c2a;border-radius:0 8px 8px 0;padding:14px 16px;font-size:14px;color:#1a1a1a;line-height:1.65">{$sprgEnc}</div>
    <p style="margin:20px 0 0;font-size:12px;color:#888;text-align:center">Besvar i backoffice under Træner app → Support</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>
HTML;
}
