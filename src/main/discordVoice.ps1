$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class DiscordWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X; public int Y; }
  private delegate bool EnumWindowProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowProc callback, IntPtr param);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint id);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int length);
  public static IntPtr[] FindMainWindows(int[] processIds) {
    var results = new List<IntPtr>();
    EnumWindows((hwnd, unused) => {
      uint id;
      GetWindowThreadProcessId(hwnd, out id);
      if (Array.IndexOf(processIds, (int)id) < 0) return true;
      var text = new StringBuilder(512);
      GetWindowText(hwnd, text, text.Capacity);
      var title = text.ToString();
      if (title == "Discord" || title.EndsWith(" - Discord")) results.Add(hwnd);
      return true;
    }, IntPtr.Zero);
    return results.ToArray();
  }
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static void Activate(IntPtr hwnd) {
    SetForegroundWindow(hwnd);
  }
  [DllImport("user32.dll")] private static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] private static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
  [DllImport("user32.dll")] private static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] private static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
  public static void DragSlider(IntPtr hwnd, int fromX, int toX, int y) {
    var start = new Point { X = fromX, Y = y };
    var end = new Point { X = toX, Y = y };
    if (GetForegroundWindow() != hwnd || GetAncestor(WindowFromPoint(start), 2) != hwnd || GetAncestor(WindowFromPoint(end), 2) != hwnd)
      throw new InvalidOperationException("Discord 창을 앞에 열어 주세요.");
    SetCursorPos(fromX, y);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero);
    try {
      System.Threading.Thread.Sleep(80);
      SetCursorPos(toX, y);
      System.Threading.Thread.Sleep(150);
    } finally { mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); }
  }
}
'@
[void][DiscordWindow]::SetProcessDPIAware()

$scope = [System.Windows.Automation.TreeScope]::Descendants
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$profile = $env:VOICEBOARD_DISCORD_PROFILE | ConvertFrom-Json
$script:step = 'Discord 실행 상태'
$deadline = [DateTime]::UtcNow.AddSeconds(35)

function Find-Control($names, $type = $null, $parent = $script:root) {
  foreach ($name in $names) {
    $condition = [System.Windows.Automation.PropertyCondition]::new(
      [System.Windows.Automation.AutomationElement]::NameProperty, $name)
    if ($type) {
      $condition = [System.Windows.Automation.AndCondition]::new($condition,
        [System.Windows.Automation.PropertyCondition]::new(
          [System.Windows.Automation.AutomationElement]::ControlTypeProperty, $type))
    }
    $element = $parent.FindFirst($scope, $condition)
    if ($element) { return $element }
  }
  return $null
}

function Wait-Control($names, $type = $null, $seconds = 3) {
  $until = [DateTime]::UtcNow.AddSeconds($seconds)
  do {
    if ([DateTime]::UtcNow -gt $deadline) { throw '설정 적용 시간 초과' }
    $element = Find-Control $names $type
    if ($element) { return $element }
    Start-Sleep -Milliseconds 200
  } while ([DateTime]::UtcNow -lt $until)
  return $null
}

function Invoke-Control($element) {
  if (!$element) { throw '설정 항목을 찾지 못했습니다' }
  $pattern = $null
  if ($element.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) {
    $pattern.Invoke()
  } elseif ($element.TryGetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern, [ref]$pattern)) {
    $pattern.Select()
  } else { throw '이 Discord 버전의 설정 항목을 조작할 수 없습니다' }
  Start-Sleep -Milliseconds 200
}

function Find-Toggle($names) {
  foreach ($type in @([System.Windows.Automation.ControlType]::Button, [System.Windows.Automation.ControlType]::CheckBox)) {
    $element = Find-Control $names $type
    $pattern = $null
    if ($element -and $element.TryGetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern, [ref]$pattern)) {
      return $element
    }
  }
  return $null
}

function Set-Toggle($names, $enabled) {
  $element = Find-Toggle $names
  if (!$element) { throw '스위치를 찾지 못했습니다' }
  $pattern = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
  $expected = if ($enabled) { 'On' } else { 'Off' }
  if ($pattern.Current.ToggleState.ToString() -ne $expected) {
    $pattern.Toggle()
    Start-Sleep -Milliseconds 250
  }
  $element = Find-Toggle $names
  if (!$element -or $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState.ToString() -ne $expected) {
    throw '스위치 적용 확인 실패'
  }
}

function Get-ThresholdSlider {
  $condition = [System.Windows.Automation.PropertyCondition]::new(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Slider)
  foreach ($slider in $script:root.FindAll($scope, $condition)) {
    $parent = $slider
    for ($i = 0; $i -lt 4 -and $parent; $i++) {
      if ($parent.Current.Name -match '^(입력 감도( 설정)?|Input Sensitivity|Input Sensitivity Settings)$') {
        return $slider
      }
      $parent = $walker.GetParent($parent)
    }
  }
  return $null
}

function Read-Noise {
  $combo = Find-Control @('잡음 제거', 'Noise Suppression') ([System.Windows.Automation.ControlType]::ComboBox)
  if ($combo) { return $combo.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value }
  foreach ($label in @('없음', 'None', 'Krisp')) {
    $radio = Find-Control @($label) ([System.Windows.Automation.ControlType]::RadioButton)
    if ($radio -and $radio.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) { return $label }
  }
  return ''
}

try {
  $processes = @(Get-Process -Name Discord,DiscordPTB,DiscordCanary -ErrorAction SilentlyContinue)
  $windows = @([DiscordWindow]::FindMainWindows([int[]]$processes.Id))
  if ($windows.Count -ne 1) { throw 'Discord 창을 하나만 실행해 주세요' }
  $handle = $windows[0]
  if ([DiscordWindow]::IsIconic($handle)) { [void][DiscordWindow]::ShowWindowAsync($handle, 9) }
  else { [void][DiscordWindow]::ShowWindowAsync($handle, 5) }
  [DiscordWindow]::Activate($handle)
  Start-Sleep -Milliseconds 400
  $script:root = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  $noiseNames = @('잡음 제거', 'Noise Suppression')
  $echoNames = @('에코 억제', '에코 제거', 'Echo Cancellation')
  $autoNames = @('입력 감도 자동 조정하기', '자동으로 입력 감도 조정', 'Automatically determine input sensitivity', 'Automatically Determine Input Sensitivity')

  $script:step = '음성 설정 화면 열기'
  if (!(Wait-Control $noiseNames ([System.Windows.Automation.ControlType]::ComboBox) 1)) {
    $settings = Wait-Control @('사용자 설정', 'User Settings') ([System.Windows.Automation.ControlType]::Button)
    if ($settings) { Invoke-Control $settings }
    $voice = Wait-Control @('음성 및 비디오', 'Voice & Video') ([System.Windows.Automation.ControlType]::Hyperlink) 2
    if (!$voice) { $voice = Wait-Control @('음성 및 비디오', 'Voice & Video') ([System.Windows.Automation.ControlType]::TabItem) 1 }
    if ($voice) { Invoke-Control $voice }
  }
  $null = Wait-Control $noiseNames ([System.Windows.Automation.ControlType]::ComboBox) 4

  $script:step = '사용자 지정 음성 프로필'
  $custom = Find-Control @('사용자 지정', 'Custom') ([System.Windows.Automation.ControlType]::RadioButton)
  if ($custom -and !$custom.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected) {
    Invoke-Control $custom
  }

  $script:step = '잡음 제거'
  $labels = if ($profile.noise -eq 'krisp') { @('Krisp') } else { @('없음', 'None') }
  if ((Read-Noise) -notin $labels) {
    $combo = Find-Control $noiseNames ([System.Windows.Automation.ControlType]::ComboBox)
    if ($combo) {
      $combo.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern).Expand()
      $option = Wait-Control $labels ([System.Windows.Automation.ControlType]::ListItem)
      if (!$option) { $option = Wait-Control $labels ([System.Windows.Automation.ControlType]::RadioButton) 1 }
      Invoke-Control $option
    } else {
      Invoke-Control (Find-Control $labels ([System.Windows.Automation.ControlType]::RadioButton))
    }
  }
  if ((Read-Noise) -notin $labels) { throw '잡음 제거 적용 확인 실패' }

  $script:step = '에코 억제'
  if (!(Find-Toggle $echoNames)) {
    $advanced = Find-Control @('고급 음성 설정 보기', 'Show Advanced Voice Settings') ([System.Windows.Automation.ControlType]::Button)
    if ($advanced) { Invoke-Control $advanced }
  }
  Set-Toggle $echoNames ([bool]$profile.echo)

  $script:step = '자동 입력 감도 끄기'
  Set-Toggle $autoNames $false
  $script:step = '입력 감도'
  $slider = Get-ThresholdSlider
  if (!$slider) { throw '입력 감도 슬라이더를 찾지 못했습니다' }
  $range = $slider.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
  # Discord exposes a normalized 0..100 slider for its -100..0 dB threshold.
  if ($range.Current.Minimum -eq 0 -and $range.Current.Maximum -eq 100) {
    $value = 100 + [double]$profile.thresholdDb
  } elseif ($range.Current.Minimum -eq -100 -and $range.Current.Maximum -eq 0) {
    $value = [double]$profile.thresholdDb
  } else { throw '지원하지 않는 입력 감도 범위입니다' }
  $range.SetValue($value)
  Start-Sleep -Milliseconds 350
  $slider = Get-ThresholdSlider
  if (!$slider -or [Math]::Abs($slider.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern).Current.Value - $value) -gt 0.1) {
    # Discord's custom slider can ignore accessibility writes; use its observed track bounds.
    if (!$slider) { throw '입력 감도 슬라이더를 찾지 못했습니다' }
    [DiscordWindow]::Activate($handle)
    $slider.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()
    Start-Sleep -Milliseconds 150
    $slider = Get-ThresholdSlider
    $rect = $slider.Current.BoundingRectangle
    if ($slider.Current.IsOffscreen -or $rect.Width -lt 100 -or $rect.Height -le 0) { throw '입력 감도가 화면에 보이지 않습니다' }
    $fraction = ([double]$profile.thresholdDb + 100) / 100
    $currentRange = $slider.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern).Current
    $currentFraction = ($currentRange.Value - $currentRange.Minimum) / ($currentRange.Maximum - $currentRange.Minimum)
    [DiscordWindow]::DragSlider($handle, [int]($rect.Left + $rect.Width * $currentFraction), [int]($rect.Left + $rect.Width * $fraction), [int]($rect.Top + $rect.Height / 2))
    Start-Sleep -Milliseconds 250
    $slider = Get-ThresholdSlider
    if (!$slider -or [Math]::Abs($slider.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern).Current.Value - $value) -gt 0.25) {
      $actual = if ($slider) { $slider.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern).Current.Value } else { 'unknown' }
      throw "입력 감도 적용 확인 실패 (목표 $value, 실제 $actual)"
    }
  }
  # Verify all controls together after Discord has processed the changes.
  if ((Read-Noise) -notin $labels) { throw '잡음 제거 최종 확인 실패' }
  $echo = (Find-Toggle $echoNames).GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState.ToString()
  $auto = (Find-Toggle $autoNames).GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Current.ToggleState.ToString()
  if (($echo -eq 'On') -ne [bool]$profile.echo -or $auto -ne 'Off') { throw '음성 설정 최종 확인 실패' }
  @{ applied = $true; noise = $profile.noise; echo = $profile.echo; thresholdDb = $profile.thresholdDb } | ConvertTo-Json -Compress
} catch {
  @{ applied = $false; message = "Discord 설정 확인 필요 ($script:step): $($_.Exception.Message)" } | ConvertTo-Json -Compress
}
