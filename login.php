<?php
header('Access-Control-Allow-Origin: *');
header('Content-Type: application/json');

$data = http_build_query([
    'Version' => '2',
    'Log_ind_med' => 'email',
    'Email' => $_POST['email'],
    'Adgangskode' => $_POST['password'],
    'Foreningsid' => '1031'
]);

$ch = curl_init('https://www.conventus.dk/dataudv/api/medlemslogin/login.php');
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $data);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
$result = curl_exec($ch);
curl_close($ch);

echo $result;
?>