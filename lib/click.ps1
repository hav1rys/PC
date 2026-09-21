param([int]$x, [int]$y, [string]$button = 'left', [switch]$double)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseSim {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x, $y)
Start-Sleep -Milliseconds 80

if ($button -eq 'right') { $downFlag = 0x0008; $upFlag = 0x0010 } else { $downFlag = 0x0002; $upFlag = 0x0004 }

[MouseSim]::mouse_event($downFlag, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 50
[MouseSim]::mouse_event($upFlag, 0, 0, 0, [UIntPtr]::Zero)

if ($double) {
  Start-Sleep -Milliseconds 90
  [MouseSim]::mouse_event($downFlag, 0, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 50
  [MouseSim]::mouse_event($upFlag, 0, 0, 0, [UIntPtr]::Zero)
}
