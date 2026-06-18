[Setup]
AppName=Print Agent
AppVersion=3.0
AppPublisher=F-Soft Sistemas
DefaultDirName={autopf64}\PrintAgent
DefaultGroupName=Print Agent
OutputBaseFilename=PrintAgent-3.0-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin

[Languages]
Name: "brazilianportuguese"; MessagesFile: "compiler:Languages\BrazilianPortuguese.isl"

[Files]
; Copia os arquivos necessários. Não precisamos mais do nssm.exe!
Source: "node.exe"; DestDir: "{app}"
Source: "server.js"; DestDir: "{app}"
Source: "start-silent.vbs"; DestDir: "{app}"
Source: "node_modules\*"; DestDir: "{app}\node_modules"; Flags: recursesubdirs createallsubdirs

[Dirs]
Name: "{commonappdata}\PrintAgent"; Permissions: users-modify

[Icons]
; A MÁGICA ACONTECE AQUI:
; Cria um atalho na pasta "Inicializar" de "Todos os Usuários".
; O Windows executará este atalho toda vez que qualquer usuário fizer login.
Name: "{commonstartup}\Print Agent"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\start-silent.vbs""";

; As seções [Run] e [UninstallRun] foram removidas pois não são mais necessárias.
; O desinstalador remove o atalho automaticamente.
