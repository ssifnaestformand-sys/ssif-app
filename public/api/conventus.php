<?php
/**
 * Conventus API Proxy
 * 
 * Sikker proxy der kalder Conventus API uden at eksponere nøglen i koden.
 * Nøglen læses fra miljøvariabel eller .env fil.
 */

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');

// Handle CORS preflight
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

// Get Conventus API key from environment or .env file
$apiKey = getenv('CONVENTUS_KEY');

if (!$apiKey) {
    // Fallback: check .env file if environment variable not set
    $envFile = __DIR__ . '/../../.env';
    if (file_exists($envFile)) {
        $env = parse_ini_file($envFile);
        $apiKey = $env['CONVENTUS_KEY'] ?? null;
    }
}

if (!$apiKey) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Conventus API key not configured',
        'message' => 'CONVENTUS_KEY environment variable or .env entry is missing'
    ]);
    exit;
}

// Call Conventus API
$url = 'https://www.conventus.dk/dataudv/api/adressebog/get_medlemmer.php';
$params = [
    'forening' => '1031',
    'key' => $apiKey,
    'relationer' => 'true'
];

$fullUrl = $url . '?' . http_build_query($params);

// Make request with error handling
$context = stream_context_create([
    'http' => [
        'timeout' => 10,
        'follow_location' => false
    ]
]);

$response = @file_get_contents($fullUrl, false, $context);

if ($response === false) {
    http_response_code(503);
    echo json_encode([
        'error' => 'Failed to fetch from Conventus API',
        'message' => 'Could not reach the Conventus API endpoint'
    ]);
    exit;
}

// Return Conventus response as-is
http_response_code(200);
echo $response;
?>
