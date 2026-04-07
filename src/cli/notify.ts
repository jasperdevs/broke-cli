import { existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const RUNTIME_DIR = dirname(fileURLToPath(import.meta.url));

function getNotificationIconPath(): string | null {
  const candidates = [
    join(process.cwd(), "logos", "brokecli-square-1024.png"),
    join(RUNTIME_DIR, "..", "..", "logos", "brokecli-square-1024.png"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function resolveWindowsPowerShell(): string {
  const systemRoot = process.env.SystemRoot || "C:\\Windows";
  const candidates = [
    `${systemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`,
    "powershell.exe",
    "pwsh.exe",
  ];
  return candidates.find((candidate) => candidate.includes("\\") ? existsSync(candidate) : true) ?? "powershell.exe";
}

function escapePowerShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "''");
}

function ringTerminalBell(): void {
  try {
    process.stdout.write("\x07");
  } catch {
    // ignore bell failures
  }
}

export function sendResponseNotification(message = "Response complete"): void {
  ringTerminalBell();
  try {
    const iconPath = getNotificationIconPath();
    if (process.platform === "win32") {
      const escapedMessage = escapePowerShellSingleQuoted(message);
      const escapedIconPath = escapePowerShellSingleQuoted(iconPath ?? "");
      const script = `
$shown = $false
try {
  [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
  [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] > $null
  $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
  $template = @"
<toast>
  <visual>
    <binding template="ToastGeneric">
      <text>Terminal Agent</text>
      <text>${escapedMessage}</text>
    </binding>
  </visual>
</toast>
"@
  $xml.LoadXml($template)
  $toast = [Windows.UI.Notifications.ToastNotification]::new($xml)
  [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('Microsoft.Windows.PowerShell').Show($toast)
  $shown = $true
} catch {}
if (-not $shown) {
  try {
    $wshell = New-Object -ComObject WScript.Shell
    $null = $wshell.Popup('${escapedMessage}', 4, 'Terminal Agent', 0x40)
    $shown = $true
  } catch {}
}
if (-not $shown) {
  try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Windows.Forms.NotifyIcon
    $iconObj = $null
    if ('${escapedIconPath}') {
      try {
        $bitmap = New-Object System.Drawing.Bitmap '${escapedIconPath}'
        $iconObj = [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
      } catch {}
    }
    if ($iconObj -eq $null) {
      $iconObj = [System.Drawing.SystemIcons]::Information
    }
    $icon.Icon = $iconObj
    $icon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
    $icon.BalloonTipTitle = 'Terminal Agent'
    $icon.BalloonTipText = '${escapedMessage}'
    $icon.Visible = $true
    $icon.ShowBalloonTip(4000)
    Start-Sleep -Milliseconds 4500
    $icon.Dispose()
    $shown = $true
  } catch {}
}
try { [System.Media.SystemSounds]::Exclamation.Play() } catch {}
try { [console]::write([char]7) } catch {}
`;
      const child = spawn(resolveWindowsPowerShell(), [
        "-NoProfile",
        "-Sta",
        "-ExecutionPolicy", "Bypass",
        "-WindowStyle", "Hidden",
        "-Command", script,
      ], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
      child.unref();
      return;
    }

    if (process.platform === "darwin") {
      const script = `display notification "${message.replace(/"/g, '\\"')}" with title "Terminal Agent"`;
      const child = spawn("osascript", ["-e", script], { detached: true, stdio: "ignore" });
      child.unref();
      return;
    }

    const notifyArgs = iconPath
      ? ["--icon", iconPath, "Terminal Agent", message]
      : ["Terminal Agent", message];
    const child = spawn("notify-send", notifyArgs, {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // ignore notification failures
  }
}
