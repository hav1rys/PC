param([string]$b64)
Add-Type -AssemblyName System.Windows.Forms
$bytes = [Convert]::FromBase64String($b64)
$text = [System.Text.Encoding]::Unicode.GetString($bytes)
[System.Windows.Forms.SendKeys]::SendWait($text)
