<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$email = $_POST['Email'] ?? 'IKKE MODTAGET';
$password = $_POST['Adgangskode'] ?? 'IKKE MODTAGET';

$data = http_build_query([
    'Version' => '2',
    'Log_ind_med' => 'email',
    'Email' => $email,
    'Adgangskode' => $password,
    'Foreningsid' => '1031'
]);

$ch = curl_init('https://www.conventus.dk/dataudv/api/medlemslogin/login.php');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, false);
$result = curl_exec($ch);
curl_close($ch);

echo json_encode([
    'debug_email' => $email,
    'debug_password' => $password,
    'conventus_svar' => json_decode($result)
]);
?>