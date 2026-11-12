<?php
/**
 * Besvar en supporthenvendelse og send svar-mail til træneren.
 *
 * POST  Authorization: Bearer <admin Firebase ID-token>
 *       { supportId, answer, authorEmail, authorName, question, category }
 */

require_once __DIR__ . '/_auth.php';
require_once __DIR__ . '/_send_helpers.php';
header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Authorization, Content-Type');
set_cors_headers();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(200); exit; }
if ($_SERVER['REQUEST_METHOD'] !== 'POST')    { http_response_code(405); echo json_encode(['error' => 'Kun POST']); exit; }

$auth       = trainer_auth();
$fsToken    = $auth['fsToken'];
$projectId  = $auth['projectId'];
$base       = $auth['base'];
$svarGivetAf = $auth['displayName'] ?: $auth['email'];

$body        = json_decode(file_get_contents('php://input'), true) ?? [];
$supportId   = trim((string)($body['supportId']   ?? ''));
$answer      = trim((string)($body['answer']      ?? ''));
$authorEmail = trim((string)($body['authorEmail'] ?? ''));
$authorName  = trim((string)($body['authorName']  ?? ''));
$question    = trim((string)($body['question']    ?? ''));
$category    = trim((string)($body['category']    ?? ''));

if (!$supportId || !$answer) {
    http_response_code(400); echo json_encode(['error' => 'supportId og answer er påkrævet']); exit;
}

// ── Opdatér Firestore ─────────────────────────────────────────────────────────
$ok = fs_commit($projectId, $fsToken, [[
    'update' => [
        'name'   => "{$base}/support/{$supportId}",
        'fields' => [
            'answer'      => ['stringValue'    => $answer],
            'status'      => ['stringValue'    => 'besvaret'],
            'answeredAt'  => ['timestampValue' => date('Y-m-d\TH:i:s\Z')],
            'answeredBy'  => ['stringValue'    => $svarGivetAf],
        ],
    ],
    'updateMask' => ['fieldPaths' => ['answer', 'status', 'answeredAt', 'answeredBy']],
]]);

if (!$ok) { http_response_code(500); echo json_encode(['error' => 'Firestore-opdatering fejlede']); exit; }

// ── Send svar-mail til træneren ───────────────────────────────────────────────
if ($authorEmail && filter_var($authorEmail, FILTER_VALIDATE_EMAIL)) {
    $subj = 'Svar på din supporthenvendelse — SSIF';
    smtp_send_html($authorEmail, $subj, byg_svar_html($authorName, $question, $category, $answer, $svarGivetAf), 'SSIF Support');
}

echo json_encode(['ok' => true]);

// ── Mail-template ─────────────────────────────────────────────────────────────
function byg_svar_html(string $modtager, string $question, string $category, string $answer, string $svarFra): string {
    $modtEnc  = htmlspecialchars($modtager);
    $hilsen   = $modtager ? "<p style=\"margin:0 0 16px;font-size:14px;color:#4a4a4a\">Hej {$modtEnc},</p>" : '';
    $katEnc   = htmlspecialchars($category);
    $sprgEnc  = nl2br(htmlspecialchars($question));
    $svarEnc  = nl2br(htmlspecialchars($answer));
    $fraEnc   = htmlspecialchars($svarFra);
    return <<<HTML
<!DOCTYPE html>
<html lang="da">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f4;font-family:system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0">
<tr><td align="center" style="padding:24px 16px">
<table width="100%" style="max-width:480px;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 6px rgba(0,0,0,.08)">
  <tr><td style="background:#1a5c2a;padding:18px 24px">
    <p style="margin:0;color:#fff;font-size:18px;font-weight:800">&#9917; SSIF - Svar på din henvendelse</p>
  </td></tr>
  <tr><td style="padding:24px">
    {$hilsen}
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#888">Dit spørgsmål ({$katEnc})</p>
    <div style="background:#f4f6f4;border-radius:8px;padding:12px 14px;margin-bottom:20px;font-size:13px;color:#666;line-height:1.6">{$sprgEnc}</div>
    <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#888">Svar fra {$fraEnc}</p>
    <div style="background:#f0fdf4;border-left:3px solid #1a5c2a;border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:20px;font-size:14px;color:#1a1a1a;line-height:1.65">{$svarEnc}</div>
    <p style="margin:0;font-size:12px;color:#888;text-align:center">Venlig hilsen &middot; Sejs-Svejb&aelig;k IF</p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>
HTML;
}
