#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef AppId
  #define AppId "QuotaBar.Windows"
#endif
#ifndef AppName
  #define AppName "QuotaBar"
#endif

[Setup]
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=QuotaBar
AppPublisherURL=https://github.com/mrlfarano/QuotaBar
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=QuotaBar-{#AppVersion}-Setup-x64
SetupIconFile={#IconFile}
UninstallDisplayIcon={app}\QuotaBar.exe
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\QuotaBar.exe"; Parameters: "--panel"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\QuotaBar.exe"; Parameters: "--panel"; Tasks: desktopicon

[Run]
Filename: "{app}\QuotaBar.exe"; Parameters: "--panel"; Description: "Launch QuotaBar"; Flags: nowait postinstall skipifsilent

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  StartupCommand: String;
  InstalledExe: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    InstalledExe := ExpandConstant('{app}\QuotaBar.exe');
    if RegQueryStringValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', '{#AppName}', StartupCommand) then
      if (CompareText(Trim(StartupCommand), '"' + InstalledExe + '"') = 0) or
         (CompareText(Trim(StartupCommand), InstalledExe) = 0) then
        RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', '{#AppName}');
  end;
end;
