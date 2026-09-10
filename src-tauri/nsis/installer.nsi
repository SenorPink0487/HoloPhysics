Unicode true
ManifestDPIAware true
ManifestDPIAwareness PerMonitorV2

!if "{{compression}}" == "none"
  SetCompress off
!else
  SetCompressor /SOLID "{{compression}}"
!endif

{{#if signed_plugins_path}}
!addplugindir "{{signed_plugins_path}}"
{{/if}}

!include MUI2.nsh
!include FileFunc.nsh
!include x64.nsh
!include WordFunc.nsh
!include "utils.nsh"
!include "FileAssociation.nsh"
!include "Win\COM.nsh"
!include "Win\Propkey.nsh"
!include "StrFunc.nsh"
${StrCase}
${StrLoc}

{{#if installer_hooks}}
!include "{{installer_hooks}}"
{{/if}}

!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!define MANUFACTURER "{{manufacturer}}"
!define PRODUCTNAME "{{product_name}}"
!define VERSION "{{version}}"
!define VERSIONWITHBUILD "{{version_with_build}}"
!define HOMEPAGE "{{homepage}}"
!define INSTALLMODE "{{install_mode}}"
!define LICENSE "{{license}}"
!define INSTALLERICON "{{installer_icon}}"
!define SIDEBARIMAGE "{{sidebar_image}}"
!define HEADERIMAGE "{{header_image}}"
!define UNINSTALLERICON "{{uninstaller_icon}}"
!define UNINSTALLERHEADERIMAGE "{{uninstaller_header_image}}"
!define MAINBINARYNAME "{{main_binary_name}}"
!define MAINBINARYSRCPATH "{{main_binary_path}}"
!define MAINBINARYDIR "${MAINBINARYSRCPATH}"
!searchreplace MAINBINARYDIR "${MAINBINARYDIR}" "${MAINBINARYNAME}.exe" ""
!define BUNDLEID "{{bundle_id}}"
!define COPYRIGHT "{{copyright}}"
!define OUTFILE "{{out_file}}"
!define ARCH "{{arch}}"
!define ADDITIONALPLUGINSPATH "{{additional_plugins_path}}"
!define ALLOWDOWNGRADES "{{allow_downgrades}}"
!define DISPLAYLANGUAGESELECTOR "{{display_language_selector}}"
!define INSTALLWEBVIEW2MODE "{{install_webview2_mode}}"
!define WEBVIEW2INSTALLERARGS "{{webview2_installer_args}}"
!define WEBVIEW2BOOTSTRAPPERPATH "{{webview2_bootstrapper_path}}"
!define WEBVIEW2INSTALLERPATH "{{webview2_installer_path}}"
!define MINIMUMWEBVIEW2VERSION "{{minimum_webview2_version}}"
!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${PRODUCTNAME}"
!define MANUKEY "Software\${MANUFACTURER}"
!define MANUPRODUCTKEY "${MANUKEY}\${PRODUCTNAME}"
!define UNINSTALLERSIGNCOMMAND "{{uninstaller_sign_cmd}}"
!define ESTIMATEDSIZE "{{estimated_size}}"
!define STARTMENUFOLDER "{{start_menu_folder}}"

Var PassiveMode
Var UpdateMode
Var NoShortcutMode
Var WixMode
Var OldMainBinaryName

Var InnerDlgHWnd
Var PercentLabelHWnd
Var ProgressBarHWnd
Var LastPercent
Var TimerId
Var BgBitmapHandle
Var FontHandle
Var InstallFileCount

Name "${PRODUCTNAME}"
BrandingText "${COPYRIGHT}"
OutFile "${OUTFILE}"

!define PLACEHOLDER_INSTALL_DIR "placeholder\${PRODUCTNAME}"
InstallDir "${PLACEHOLDER_INSTALL_DIR}"

VIProductVersion "${VERSIONWITHBUILD}"
VIAddVersionKey "ProductName" "${PRODUCTNAME}"
VIAddVersionKey "FileDescription" "${PRODUCTNAME}"
VIAddVersionKey "LegalCopyright" "${COPYRIGHT}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!addplugindir "${ADDITIONALPLUGINSPATH}"

!if "${UNINSTALLERSIGNCOMMAND}" != ""
  !uninstfinalize '${UNINSTALLERSIGNCOMMAND}'
!endif

!if "${INSTALLMODE}" == "perMachine"
  RequestExecutionLevel admin
!endif

!if "${INSTALLMODE}" == "currentUser"
  RequestExecutionLevel user
!endif

!if "${INSTALLMODE}" == "both"
  !define MULTIUSER_MUI
  !define MULTIUSER_INSTALLMODE_INSTDIR "${PRODUCTNAME}"
  !define MULTIUSER_INSTALLMODE_COMMANDLINE
  !if "${ARCH}" == "x64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !else if "${ARCH}" == "arm64"
    !define MULTIUSER_USE_PROGRAMFILES64
  !endif
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_KEY "${UNINSTKEY}"
  !define MULTIUSER_INSTALLMODE_DEFAULT_REGISTRY_VALUENAME "CurrentUser"
  !define MULTIUSER_INSTALLMODEPAGE_SHOWUSERNAME
  !define MULTIUSER_INSTALLMODE_FUNCTION RestorePreviousInstallLocation
  !define MULTIUSER_EXECUTIONLEVEL Highest
  !include MultiUser.nsh
!endif

!if "${INSTALLERICON}" != ""
  Icon "${INSTALLERICON}"
  !define MUI_ICON "${INSTALLERICON}"
!endif

!if "${UNINSTALLERICON}" != ""
  UninstallIcon "${UNINSTALLERICON}"
  !define MUI_UNICON "${UNINSTALLERICON}"
!else
  !if "${INSTALLERICON}" != ""
    UninstallIcon "${INSTALLERICON}"
    !define MUI_UNICON "${INSTALLERICON}"
  !endif
!endif

!define MUI_LANGDLL_REGISTRY_ROOT "HKCU"
!define MUI_LANGDLL_REGISTRY_KEY "${MANUPRODUCTKEY}"
!define MUI_LANGDLL_REGISTRY_VALUENAME "Installer Language"

; -------------------------------------------------------------
; Single Automatic Installation Page (InstFiles with custom UI)
; -------------------------------------------------------------
!define MUI_PAGE_CUSTOMFUNCTION_SHOW InstFilesShow
!insertmacro MUI_PAGE_INSTFILES

Function InstFilesShow
  FindWindow $InnerDlgHWnd "#32770" "" $HWNDPARENT

  ; 1. Remove title bar and window frame to make it completely borderless (no icon, title, or - [] X buttons)
  System::Call 'user32::GetWindowLong(p $HWNDPARENT, i -16) i .r2'
  IntOp $2 $2 & 0xFF30FFFF
  System::Call 'user32::SetWindowLong(p $HWNDPARENT, i -16, i r2)'

  ; Clear EXSTYLE window borders
  System::Call 'user32::GetWindowLong(p $HWNDPARENT, i -20) i .r3'
  IntOp $3 $3 & 0xFFFDDCFE
  System::Call 'user32::SetWindowLong(p $HWNDPARENT, i -20, i r3)'

  ; Center on screen with exact 768x512 size
  System::Call 'user32::GetSystemMetrics(i 0) i .r4'
  System::Call 'user32::GetSystemMetrics(i 1) i .r5'
  IntOp $4 $4 - 768
  IntOp $4 $4 / 2
  IntOp $5 $5 - 512
  IntOp $5 $5 / 2

  ; Set $HWNDPARENT size and position with SWP_FRAMECHANGED (0x0020) | SWP_NOZORDER (0x0004) = 0x0024
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r4, i r5, i 768, i 512, i 0x0024)'

  ; Windows 11 rounded corners (DWMWCP_ROUND = 2)
  System::Call '*(i 2) p .r1'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 33, p r1, i 4)'
  System::Free $1

  ; Resize $InnerDlgHWnd to cover the entire window (0, 0, 768, 512)
  System::Call 'user32::SetWindowPos(p $InnerDlgHWnd, p 0, i 0, i 0, i 768, i 512, i 0x0014)'

  ; Hide and banish all controls on $HWNDPARENT
  StrCpy $0 0
  loop_controls:
    IntOp $0 $0 + 1
    ${If} $0 > 1300
      Goto done_controls
    ${EndIf}
    GetDlgItem $1 $HWNDPARENT $0
    ${If} $1 != 0
      ShowWindow $1 0
      EnableWindow $1 0
      System::Call 'user32::SetWindowPos(p r1, p 0, i -2000, i -2000, i 0, i 0, i 0x0014)'
    ${EndIf}
    Goto loop_controls
  done_controls:

  ; Hide standard inner controls on $InnerDlgHWnd
  GetDlgItem $1 $InnerDlgHWnd 1006
  ShowWindow $1 0
  GetDlgItem $1 $InnerDlgHWnd 1016
  ShowWindow $1 0
  GetDlgItem $1 $InnerDlgHWnd 1027
  ShowWindow $1 0

  ; Progress bar handle (hidden visually so we can query its progress)
  GetDlgItem $ProgressBarHWnd $InnerDlgHWnd 1004
  ShowWindow $ProgressBarHWnd 0

  ; Load and set the complete user-supplied background bitmap (768x512)
  InitPluginsDir
  File "/oname=$PLUGINSDIR\background.bmp" "${MAINBINARYDIR}\..\..\..\nsis\background.bmp"
  System::Call 'user32::LoadImage(p 0, w "$PLUGINSDIR\background.bmp", i 0, i 768, i 512, i 0x00000010) p .r5'
  StrCpy $BgBitmapHandle $5

  ; Set taskbar and window icon (WM_SETICON)
  File "/oname=$PLUGINSDIR\appicon.ico" "${INSTALLERICON}"
  System::Call 'user32::LoadImage(p 0, w "$PLUGINSDIR\appicon.ico", i 1, i 32, i 32, i 0x00000010) p .r1'
  ${If} $1 != 0
    SendMessage $HWNDPARENT 0x0080 0 $1 ; WM_SETICON, ICON_SMALL
    SendMessage $HWNDPARENT 0x0080 1 $1 ; WM_SETICON, ICON_BIG
  ${EndIf}

  System::Call 'user32::CreateWindowEx(i 0, w "STATIC", w "", i 0x5400000E, i 0, i 0, i 768, i 512, p $InnerDlgHWnd, i 1199, i 0, i 0) p .r6'
  SendMessage $6 0x0172 0 $BgBitmapHandle

  ; Two pure digits percentage label at center-bottom: X=314, Y=382, W=140, H=72 (SS_CENTER=0x1)
  System::Call 'user32::CreateWindowEx(i 0, w "STATIC", w "00", i 0x50000001, i 314, i 382, i 140, i 72, p $InnerDlgHWnd, i 1200, i 0, i 0) p .r7'
  StrCpy $PercentLabelHWnd $7

  ; Font: Bodoni MT, 62px, Bold (700), ClearType via CreateFontW
  System::Call 'gdi32::CreateFontW(i 62, i 0, i 0, i 0, i 700, i 0, i 0, i 0, i 1, i 0, i 0, i 5, i 0, w "Bodoni MT") p .r8'
  StrCpy $FontHandle $8
  SendMessage $PercentLabelHWnd 0x0030 $FontHandle 1

  ; Set background color to exact match #F6F7F7, text to #C6CED5 (exact HoloGrip color)
  SetCtlColors $PercentLabelHWnd "C6CED5" "F6F7F7"

  StrCpy $LastPercent 0
  StrCpy $TimerId 0
FunctionEnd

Function StepToPercent
  ; Input: $R0 (target percent)
  ${If} $PercentLabelHWnd != 0
    ${While} $LastPercent < $R0
      IntOp $LastPercent $LastPercent + 1
      ${If} $LastPercent < 10
        StrCpy $1 "0$LastPercent"
      ${ElseIf} $LastPercent >= 100
        StrCpy $1 "99"
      ${Else}
        StrCpy $1 "$LastPercent"
      ${EndIf}
      SendMessage $PercentLabelHWnd 0x000C 0 "STR:$1"
      Sleep 8
    ${EndWhile}
  ${EndIf}
FunctionEnd

Function UpdateInstallPercent
  ${If} $LastPercent < 85
    IntOp $R0 $LastPercent + 10
    Call StepToPercent
  ${EndIf}
FunctionEnd

Function RunMainBinary
  nsis_tauri_utils::RunAsUser "$INSTDIR\${MAINBINARYNAME}.exe" ""
FunctionEnd

; -------------------------------------------------------------
; Single Automatic Uninstallation Page (UninstFiles with custom UI)
; -------------------------------------------------------------
!define MUI_PAGE_CUSTOMFUNCTION_SHOW un.InstFilesShow
!insertmacro MUI_UNPAGE_INSTFILES

Function un.InstFilesShow
  FindWindow $InnerDlgHWnd "#32770" "" $HWNDPARENT

  ; 1. Remove title bar and window frame to make it completely borderless
  System::Call 'user32::GetWindowLong(p $HWNDPARENT, i -16) i .r2'
  IntOp $2 $2 & 0xFF30FFFF
  System::Call 'user32::SetWindowLong(p $HWNDPARENT, i -16, i r2)'

  ; Clear EXSTYLE window borders
  System::Call 'user32::GetWindowLong(p $HWNDPARENT, i -20) i .r3'
  IntOp $3 $3 & 0xFFFDDCFE
  System::Call 'user32::SetWindowLong(p $HWNDPARENT, i -20, i r3)'

  ; Center on screen with exact 768x512 size
  System::Call 'user32::GetSystemMetrics(i 0) i .r4'
  System::Call 'user32::GetSystemMetrics(i 1) i .r5'
  IntOp $4 $4 - 768
  IntOp $4 $4 / 2
  IntOp $5 $5 - 512
  IntOp $5 $5 / 2

  ; Set $HWNDPARENT size and position with SWP_FRAMECHANGED (0x0020) | SWP_NOZORDER (0x0004) = 0x0024
  System::Call 'user32::SetWindowPos(p $HWNDPARENT, p 0, i r4, i r5, i 768, i 512, i 0x0024)'

  ; Windows 11 rounded corners (DWMWCP_ROUND = 2)
  System::Call '*(i 2) p .r1'
  System::Call 'dwmapi::DwmSetWindowAttribute(p $HWNDPARENT, i 33, p r1, i 4)'
  System::Free $1

  ; Resize $InnerDlgHWnd to cover the entire window (0, 0, 768, 512)
  System::Call 'user32::SetWindowPos(p $InnerDlgHWnd, p 0, i 0, i 0, i 768, i 512, i 0x0014)'

  ; Hide and banish all controls on $HWNDPARENT
  StrCpy $0 0
  un_loop_controls:
    IntOp $0 $0 + 1
    ${If} $0 > 1300
      Goto un_done_controls
    ${EndIf}
    GetDlgItem $1 $HWNDPARENT $0
    ${If} $1 != 0
      ShowWindow $1 0
      EnableWindow $1 0
      System::Call 'user32::SetWindowPos(p r1, p 0, i -2000, i -2000, i 0, i 0, i 0x0014)'
    ${EndIf}
    Goto un_loop_controls
  un_done_controls:

  ; Hide standard inner controls on $InnerDlgHWnd
  GetDlgItem $1 $InnerDlgHWnd 1006
  ShowWindow $1 0
  GetDlgItem $1 $InnerDlgHWnd 1016
  ShowWindow $1 0
  GetDlgItem $1 $InnerDlgHWnd 1027
  ShowWindow $1 0

  ; Progress bar handle (hidden visually so we can query its progress)
  GetDlgItem $ProgressBarHWnd $InnerDlgHWnd 1004
  ShowWindow $ProgressBarHWnd 0

  ; Load and set the complete user-supplied background bitmap (768x512)
  InitPluginsDir
  File "/oname=$PLUGINSDIR\background.bmp" "${MAINBINARYDIR}\..\..\..\nsis\background.bmp"
  System::Call 'user32::LoadImage(p 0, w "$PLUGINSDIR\background.bmp", i 0, i 768, i 512, i 0x00000010) p .r5'
  StrCpy $BgBitmapHandle $5

  ; Set taskbar and window icon (WM_SETICON)
  File "/oname=$PLUGINSDIR\appicon.ico" "${INSTALLERICON}"
  System::Call 'user32::LoadImage(p 0, w "$PLUGINSDIR\appicon.ico", i 1, i 32, i 32, i 0x00000010) p .r1'
  ${If} $1 != 0
    SendMessage $HWNDPARENT 0x0080 0 $1 ; WM_SETICON, ICON_SMALL
    SendMessage $HWNDPARENT 0x0080 1 $1 ; WM_SETICON, ICON_BIG
  ${EndIf}

  System::Call 'user32::CreateWindowEx(i 0, w "STATIC", w "", i 0x5400000E, i 0, i 0, i 768, i 512, p $InnerDlgHWnd, i 1199, i 0, i 0) p .r6'
  SendMessage $6 0x0172 0 $BgBitmapHandle

  ; Two pure digits percentage label at center-bottom: X=314, Y=382, W=140, H=72 (SS_CENTER=0x1)
  System::Call 'user32::CreateWindowEx(i 0, w "STATIC", w "00", i 0x50000001, i 314, i 382, i 140, i 72, p $InnerDlgHWnd, i 1200, i 0, i 0) p .r7'
  StrCpy $PercentLabelHWnd $7

  ; Font: Bodoni MT, 62px, Bold (700), ClearType via CreateFontW
  System::Call 'gdi32::CreateFontW(i 62, i 0, i 0, i 0, i 700, i 0, i 0, i 0, i 1, i 0, i 0, i 5, i 0, w "Bodoni MT") p .r8'
  StrCpy $FontHandle $8
  SendMessage $PercentLabelHWnd 0x0030 $FontHandle 1

  ; Set background color to exact match #F6F7F7, text to #C6CED5 (exact HoloGrip color)
  SetCtlColors $PercentLabelHWnd "C6CED5" "F6F7F7"

  StrCpy $LastPercent 0
FunctionEnd

Function un.StepToPercent
  ; Input: $R0 (target percent)
  ${If} $PercentLabelHWnd != 0
    ${While} $LastPercent < $R0
      IntOp $LastPercent $LastPercent + 1
      ${If} $LastPercent < 10
        StrCpy $1 "0$LastPercent"
      ${ElseIf} $LastPercent >= 100
        StrCpy $1 "99"
      ${Else}
        StrCpy $1 "$LastPercent"
      ${EndIf}
      SendMessage $PercentLabelHWnd 0x000C 0 "STR:$1"
      Sleep 8
    ${EndWhile}
  ${EndIf}
FunctionEnd

; Languages
{{#each languages}}
!insertmacro MUI_LANGUAGE "{{this}}"
{{/each}}
!insertmacro MUI_RESERVEFILE_LANGDLL
{{#each language_files}}
  !include "{{this}}"
{{/each}}

Function .onInit
  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/NS" $NoShortcutMode
  ${IfNot} ${Errors}
    StrCpy $NoShortcutMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}

  !if "${DISPLAYLANGUAGESELECTOR}" == "true"
    !insertmacro MUI_LANGDLL_DISPLAY
  !endif

  !insertmacro SetContext

  ${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"
    !if "${INSTALLMODE}" == "perMachine"
      ${If} ${RunningX64}
        !if "${ARCH}" == "x64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else if "${ARCH}" == "arm64"
          StrCpy $INSTDIR "$PROGRAMFILES64\${PRODUCTNAME}"
        !else
          StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
        !endif
      ${Else}
        StrCpy $INSTDIR "$PROGRAMFILES\${PRODUCTNAME}"
      ${EndIf}
    !else if "${INSTALLMODE}" == "currentUser"
      StrCpy $INSTDIR "$LOCALAPPDATA\${PRODUCTNAME}"
    !endif

    Call RestorePreviousInstallLocation
  ${EndIf}

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_INIT
  !endif
FunctionEnd

Section EarlyChecks
  !if "${ALLOWDOWNGRADES}" == "false"
  ${If} ${Silent}
    ${If} $R0 = -1
      System::Call 'kernel32::AttachConsole(i -1)i.r0'
      ${If} $0 <> 0
        System::Call 'kernel32::GetStdHandle(i -11)i.r0'
        System::call 'kernel32::SetConsoleTextAttribute(i r0, i 0x0004)'
        FileWrite $0 "$(silentDowngrades)"
      ${EndIf}
      Abort
    ${EndIf}
  ${EndIf}
  !endif
SectionEnd

Section WebView2
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}

  ${If} $4 == ""
    ${If} $UpdateMode <> 1
      !if "${INSTALLWEBVIEW2MODE}" == "downloadBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        DetailPrint "$(webview2Downloading)"
        NSISdl::download "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Pop $0
        ${If} $0 == "success"
          DetailPrint "$(webview2DownloadSuccess)"
        ${Else}
          DetailPrint "$(webview2DownloadError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "embedBootstrapper"
        Delete "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebview2Setup.exe" "${WEBVIEW2BOOTSTRAPPERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebview2Setup.exe"
        Goto install_webview2
      !endif

      !if "${INSTALLWEBVIEW2MODE}" == "offlineInstaller"
        Delete "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        File "/oname=$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe" "${WEBVIEW2INSTALLERPATH}"
        DetailPrint "$(installingWebview2)"
        StrCpy $6 "$TEMP\MicrosoftEdgeWebView2RuntimeInstaller.exe"
        Goto install_webview2
      !endif

      Goto webview2_done

      install_webview2:
        DetailPrint "$(installingWebview2)"
        ExecWait "$6 ${WEBVIEW2INSTALLERARGS} /install" $1
        ${If} $1 = 0
          DetailPrint "$(webview2InstallSuccess)"
        ${Else}
          DetailPrint "$(webview2InstallError)"
          Abort "$(webview2AbortError)"
        ${EndIf}
      webview2_done:
    ${EndIf}
  ${Else}
    !if "${MINIMUMWEBVIEW2VERSION}" != ""
      ${VersionCompare} "${MINIMUMWEBVIEW2VERSION}" "$4" $R0
      ${If} $R0 = 1
        update_webview:
          DetailPrint "$(installingWebview2)"
          ${If} ${RunningX64}
            ReadRegStr $R1 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate" "path"
          ${Else}
            ReadRegStr $R1 HKLM "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 == ""
            ReadRegStr $R1 HKCU "SOFTWARE\Microsoft\EdgeUpdate" "path"
          ${EndIf}
          ${If} $R1 != ""
            ExecWait `"$R1" /install appguid=${WEBVIEW2APPGUID}&needsadmin=true` $1
            ${If} $1 = 0
              DetailPrint "$(webview2InstallSuccess)"
            ${Else}
              MessageBox MB_ICONEXCLAMATION|MB_ABORTRETRYIGNORE "$(webview2InstallError)" IDIGNORE ignore IDRETRY update_webview
              Quit
              ignore:
            ${EndIf}
          ${EndIf}
      ${EndIf}
    !endif
  ${EndIf}
SectionEnd

Section Install
  SetOutPath $INSTDIR

  !ifmacrodef NSIS_HOOK_PREINSTALL
    !insertmacro NSIS_HOOK_PREINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  StrCpy $R0 25
  Call StepToPercent

  ; Copy main executable
  File "${MAINBINARYSRCPATH}"
  IntOp $InstallFileCount $InstallFileCount + 1
  StrCpy $R0 80
  Call StepToPercent

  ; Copy resources
  {{#each resources_dirs}}
    CreateDirectory "$INSTDIR\\{{this}}"
  {{/each}}
  {{#each resources}}
    File /a "/oname={{this.[1]}}" "{{no-escape @key}}"
    IntOp $InstallFileCount $InstallFileCount + 1
    Call UpdateInstallPercent
  {{/each}}

  ; Copy external binaries
  {{#each binaries}}
    File /a "/oname={{this}}" "{{no-escape @key}}"
    IntOp $InstallFileCount $InstallFileCount + 1
    Call UpdateInstallPercent
  {{/each}}

  ; Create file associations
  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
       !insertmacro APP_ASSOCIATE "{{ext}}" "{{or association.name ext}}" "{{association-description association.description ext}}" "$INSTDIR\${MAINBINARYNAME}.exe,0" "Open with ${PRODUCTNAME}" "$INSTDIR\${MAINBINARYNAME}.exe $\"%1$\""
    {{/each}}
  {{/each}}

  ; Register deep links
  {{#each deep_link_protocols as |protocol| ~}}
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "URL Protocol" ""
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}" "" "URL:${BUNDLEID} protocol"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\DefaultIcon" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0"
    WriteRegStr SHCTX "Software\Classes\\{{protocol}}\shell\open\command" "" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
  {{/each}}

  ; Clean up legacy uninstaller name if present
  ${If} ${FileExists} "$INSTDIR\uninstall.exe"
    Delete "$INSTDIR\uninstall.exe"
  ${EndIf}

  ; Create uninstaller
  WriteUninstaller "$INSTDIR\卸载程序.exe"

  ; Save $INSTDIR in registry for future installations
  WriteRegStr SHCTX "${MANUPRODUCTKEY}" "" $INSTDIR

  !if "${INSTALLMODE}" == "both"
    WriteRegStr SHCTX "${UNINSTKEY}" $MultiUser.InstallMode 1
  !endif

  ReadRegStr $OldMainBinaryName SHCTX "${UNINSTKEY}" "MainBinaryName"
  ${If} $OldMainBinaryName != ""
  ${AndIf} $OldMainBinaryName != "${MAINBINARYNAME}.exe"
    Delete "$INSTDIR\$OldMainBinaryName"
  ${EndIf}

  WriteRegStr SHCTX "${UNINSTKEY}" "MainBinaryName" "${MAINBINARYNAME}.exe"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayName" "${PRODUCTNAME}"
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayIcon" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr SHCTX "${UNINSTKEY}" "Publisher" "${MANUFACTURER}"
  WriteRegStr SHCTX "${UNINSTKEY}" "InstallLocation" "$\"$INSTDIR$\""
  WriteRegStr SHCTX "${UNINSTKEY}" "UninstallString" "$\"$INSTDIR\卸载程序.exe$\""
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoModify" "1"
  WriteRegDWORD SHCTX "${UNINSTKEY}" "NoRepair" "1"

  ${GetSize} "$INSTDIR" "/M=卸载程序.exe /S=0K /G=0" $0 $1 $2
  IntOp $0 $0 + ${ESTIMATEDSIZE}
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD SHCTX "${UNINSTKEY}" "EstimatedSize" "$0"

  !if "${HOMEPAGE}" != ""
    WriteRegStr SHCTX "${UNINSTKEY}" "URLInfoAbout" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "URLUpdateInfo" "${HOMEPAGE}"
    WriteRegStr SHCTX "${UNINSTKEY}" "HelpLink" "${HOMEPAGE}"
  !endif

  ; Create start menu shortcut
  Call CreateOrUpdateStartMenuShortcut

  ; Always automatically create desktop shortcut
  Call CreateOrUpdateDesktopShortcut

  !ifmacrodef NSIS_HOOK_POSTINSTALL
    !insertmacro NSIS_HOOK_POSTINSTALL
  !endif

  StrCpy $R0 95
  Call StepToPercent

  SetAutoClose true
SectionEnd

Function .onInstSuccess
  ${If} $TimerId != 0
    System::Call 'user32::KillTimer(p $HWNDPARENT, i $TimerId)'
  ${EndIf}
  StrCpy $R0 99
  Call StepToPercent
  Sleep 600

  ; Automatically launch app upon completion
  Call RunMainBinary
FunctionEnd

Function un.onInit
  !insertmacro SetContext

  !if "${INSTALLMODE}" == "both"
    !insertmacro MULTIUSER_UNINIT
  !endif

  !insertmacro MUI_UNGETLANGUAGE

  ${GetOptions} $CMDLINE "/P" $PassiveMode
  ${IfNot} ${Errors}
    StrCpy $PassiveMode 1
  ${EndIf}

  ${GetOptions} $CMDLINE "/UPDATE" $UpdateMode
  ${IfNot} ${Errors}
    StrCpy $UpdateMode 1
  ${EndIf}
FunctionEnd

Section Uninstall
  !ifmacrodef NSIS_HOOK_PREUNINSTALL
    !insertmacro NSIS_HOOK_PREUNINSTALL
  !endif

  !insertmacro CheckIfAppIsRunning "${MAINBINARYNAME}.exe" "${PRODUCTNAME}"

  StrCpy $R0 25
  Call un.StepToPercent

  Delete "$INSTDIR\${MAINBINARYNAME}.exe"
  Delete "$INSTDIR\quantum-physics-lab.exe"

  {{#each resources}}
    Delete "$INSTDIR\\{{this.[1]}}"
  {{/each}}

  StrCpy $R0 60
  Call un.StepToPercent

  {{#each binaries}}
    Delete "$INSTDIR\\{{this}}"
  {{/each}}

  {{#each file_associations as |association| ~}}
    {{#each association.ext as |ext| ~}}
      !insertmacro APP_UNASSOCIATE "{{ext}}" "{{or association.name ext}}"
    {{/each}}
  {{/each}}

  {{#each deep_link_protocols as |protocol| ~}}
    ReadRegStr $R7 SHCTX "Software\Classes\\{{protocol}}\shell\open\command" ""
    ${If} $R7 == "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\""
      DeleteRegKey SHCTX "Software\Classes\\{{protocol}}"
    ${EndIf}
  {{/each}}

  Delete "$INSTDIR\卸载程序.exe"
  Delete "$INSTDIR\uninstall.exe"

  {{#each resources_ancestors}}
  RMDir /REBOOTOK "$INSTDIR\\{{this}}"
  {{/each}}
  RMDir "$INSTDIR"

  ${If} $UpdateMode <> 1
    !insertmacro DeleteAppUserModelId

    !if "${STARTMENUFOLDER}" != ""
      !insertmacro IsShortcutTarget "$SMPROGRAMS\${STARTMENUFOLDER}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      Pop $0
      ${If} $0 = 1
        !insertmacro UnpinShortcut "$SMPROGRAMS\${STARTMENUFOLDER}\${PRODUCTNAME}.lnk"
        Delete "$SMPROGRAMS\${STARTMENUFOLDER}\${PRODUCTNAME}.lnk"
        RMDir "$SMPROGRAMS\${STARTMENUFOLDER}"
      ${EndIf}
    !endif
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk"
      Delete "$SMPROGRAMS\${PRODUCTNAME}.lnk"
    ${EndIf}

    !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      !insertmacro UnpinShortcut "$DESKTOP\${PRODUCTNAME}.lnk"
      Delete "$DESKTOP\${PRODUCTNAME}.lnk"
    ${EndIf}
  ${EndIf}

  !if "${INSTALLMODE}" == "both"
    DeleteRegKey SHCTX "${UNINSTKEY}"
  !else if "${INSTALLMODE}" == "perMachine"
    DeleteRegKey HKLM "${UNINSTKEY}"
  !else
    DeleteRegKey HKCU "${UNINSTKEY}"
  !endif

  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"
  ${EndIf}

  ${If} $UpdateMode <> 1
    DeleteRegKey SHCTX "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty SHCTX "${MANUKEY}"
    DeleteRegValue HKCU "${MANUPRODUCTKEY}" "Installer Language"
    DeleteRegKey /ifempty HKCU "${MANUPRODUCTKEY}"
    DeleteRegKey /ifempty HKCU "${MANUKEY}"

    SetShellVarContext current
    RmDir /r "$APPDATA\${BUNDLEID}"
    RmDir /r "$LOCALAPPDATA\${BUNDLEID}"
  ${EndIf}

  !ifmacrodef NSIS_HOOK_POSTUNINSTALL
    !insertmacro NSIS_HOOK_POSTUNINSTALL
  !endif

  StrCpy $R0 95
  Call un.StepToPercent

  SetAutoClose true
SectionEnd

Function un.onUninstSuccess
  StrCpy $R0 99
  Call un.StepToPercent
  Sleep 600
FunctionEnd

Function RestorePreviousInstallLocation
  ReadRegStr $4 SHCTX "${MANUPRODUCTKEY}" ""
  StrCmp $4 "" +2 0
    StrCpy $INSTDIR $4
FunctionEnd

Function Skip
  Abort
FunctionEnd

Function SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function un.SkipIfPassive
  ${IfThen} $PassiveMode = 1  ${|} Abort ${|}
FunctionEnd

Function CreateOrUpdateStartMenuShortcut
  StrCpy $R0 0

  !if "${STARTMENUFOLDER}" != ""
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${STARTMENUFOLDER}\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
    Pop $0
    ${If} $0 = 1
      !insertmacro SetShortcutTarget "$SMPROGRAMS\${STARTMENUFOLDER}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
      StrCpy $R0 1
    ${EndIf}
  !endif

  !insertmacro IsShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    StrCpy $R0 1
  ${EndIf}

  ${If} $R0 = 1
    Return
  ${EndIf}

  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  !if "${STARTMENUFOLDER}" != ""
    CreateDirectory "$SMPROGRAMS\${STARTMENUFOLDER}"
    CreateShortcut "$SMPROGRAMS\${STARTMENUFOLDER}\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${STARTMENUFOLDER}\${PRODUCTNAME}.lnk"
  !else
    CreateShortcut "$SMPROGRAMS\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    !insertmacro SetLnkAppUserModelId "$SMPROGRAMS\${PRODUCTNAME}.lnk"
  !endif
FunctionEnd

Function CreateOrUpdateDesktopShortcut
  !insertmacro IsShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\$OldMainBinaryName"
  Pop $0
  ${If} $0 = 1
    !insertmacro SetShortcutTarget "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Return
  ${EndIf}

  ${If} $WixMode = 0
    ${If} $UpdateMode = 1
    ${OrIf} $NoShortcutMode = 1
      Return
    ${EndIf}
  ${EndIf}

  CreateShortcut "$DESKTOP\${PRODUCTNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
  !insertmacro SetLnkAppUserModelId "$DESKTOP\${PRODUCTNAME}.lnk"
FunctionEnd
