param([int]$x1, [int]$y1, [int]$x2, [int]$y2)
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class MouseSim {
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
}
"@
[System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($x1, $y1)
Start-Sleep -Milliseconds 100
[MouseSim]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 100

$steps = 20
for ($i = 1; $i -le $steps; $i++) {
  $ix = [int]($x1 + ($x2 - $x1) * $i / $steps)
  $iy = [int]($y1 + ($y2 - $y1) * $i / $steps)
  [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point($ix, $iy)
  Start-Sleep -Milliseconds 15
}

Start-Sleep -Milliseconds 100
[MouseSim]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
