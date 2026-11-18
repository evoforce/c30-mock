; =============================================================================
;  C30 安装器 —— 白底蓝色调、无边框圆角卡片、四个界面状态
;
;  编译入口：scripts/build-installer.mjs（用 ISCC /D 宏传入应用元信息）
;
;  wpWelcome     logo + 名称 + 版本／中间「一键安装」大按钮／右侧「自定义安装」／底部文案
;  wpSelectDir   自定义安装：安装位置 + 浏览…（调 Inno 原生文件夹选择框）
;  wpInstalling  软件介绍图轮播（3.2s 自动切换）+ 小火箭跟随进度条 + 百分比
;  wpFinished    安装完成 + 「完成安装」按钮
;
;  素材注意：Inno 的 TBitmapImage 用 PngImage 加载**不做 alpha 混合**，所以除火箭外的
;  素材都是"预先合成好背景的不透明图"；火箭用 32 位 BMP + TAlphaBitmap 才有透明。
; =============================================================================

#ifndef AppName
  #define AppName "C30"
#endif
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef AppExeName
  #define AppExeName "C30.exe"
#endif
#ifndef AppDirName
  #define AppDirName "{#AppName}"
#endif
#ifndef AppPublisher
  #define AppPublisher "C30"
#endif
#ifndef AppId
  #define AppId "{{00000000-0000-0000-0000-000000000000}"
#endif
#ifndef PayloadDir
  #define PayloadDir "payload"
#endif
#ifndef AssetDir
  #define AssetDir "..\..\assets\installer"
#endif
#ifndef OutputDir
  #define OutputDir "..\release"
#endif
#ifndef OutputBaseFilename
  #define OutputBaseFilename "Setup"
#endif
#ifndef SetupIcon
  #define SetupIcon "..\..\assets\logo\c30.ico"
#endif
#ifndef LangFile
  #define LangFile "ChineseSimplified.isl"
#endif
; x64 包用 x64compatible（Arm64 Win11 上也能装/跑），arm64 包用 arm64
#ifndef Arch
  #define Arch "x64compatible"
#endif
#ifndef ArchSlug
  #define ArchSlug "x64"
#endif
; 压缩方式：正式构建用 lzma2/max；截图/调试构建可传 none 加快编译
#ifndef CompressionMethod
  #define CompressionMethod "lzma2/max"
#endif

[Setup]
; AppId 决定"同一个应用"的安装/升级/卸载归属，每应用固定且永不改动
AppId={#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} 安装程序
VersionInfoProductName={#AppName}
VersionInfoProductVersion={#AppVersion}
VersionInfoVersion={#AppVersion}

; 按用户安装（与原先 electron-builder 默认一致），不弹 UAC
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#AppDirName}
DefaultGroupName={#AppName}
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}
AllowNoIcons=yes

; 目录页保留（自定义安装靠它取路径），但默认由 ShouldSkipPage 跳过
DisableDirPage=no
DisableReadyPage=yes
DisableProgramGroupPage=yes

ArchitecturesAllowed={#Arch}
ArchitecturesInstallIn64BitMode={#Arch}

OutputDir={#OutputDir}
OutputBaseFilename={#OutputBaseFilename}
SetupIconFile={#SetupIcon}
Compression={#CompressionMethod}
SolidCompression=yes
WizardStyle=modern
ShowLanguageDialog=no
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "chs"; MessagesFile: "{#LangFile}"

[Files]
; ---- 界面素材（打进安装包，运行时解到 {tmp} 再加载）
Source: "{#AssetDir}\bg.png";             DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\icon-44.png";        DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\btn-big.png";        DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\btn-big2.png";       DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\btn-ghost.png";      DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\btn-browse.png";     DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\inputbox.png";       DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\bar_track.png";      DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\bar_fill.png";       DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\slide-1.png";        DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\slide-2.png";        DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\slide-3.png";        DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\slide-4.png";        DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\rocket-a.bmp";       DestDir: "{tmp}"; Flags: dontcopy
Source: "{#AssetDir}\rocket-b.bmp";       DestDir: "{tmp}"; Flags: dontcopy

; ---- 应用本体（electron-builder --dir 的产物）
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExeName}"

[Run]
Filename: "{app}\{#AppExeName}"; Description: "启动 {#AppName}"; Flags: nowait postinstall skipifsilent

[Code]
const
  // --- Win32 ---
  GWL_STYLE = -16;
  WS_CAPTION = $00C00000;
  WS_THICKFRAME = $00040000;
  WS_SYSMENU = $00080000;
  WS_MINIMIZEBOX = $00020000;
  WS_MAXIMIZEBOX = $00010000;
  SWP_NOSIZE = $0001;
  SWP_NOMOVE = $0002;
  SWP_NOZORDER = $0004;
  SWP_FRAMECHANGED = $0020;
  BM_CLICK = $00F5;

  // --- 卡片布局（96 DPI 基准，运行时按 ScaleX/ScaleY 放大）---
  CARD_W = 560;
  CARD_H = 300;
  PAD = 28;
  BAR_W = 504;
  BAR_H = 10;
  BAR_Y = 212;
  ROCKET_SIZE = 44;
  SLIDE_Y = 88;
  SLIDE_W = 504;
  SLIDE_H = 100;
  BIG_W = 224;
  BIG_H = 52;

  // --- 颜色：Delphi TColor 是 $00BBGGRR（和 #RRGGBB 字节序相反）---
  CL_CARD = $00FFFFFF;    // #FFFFFF
  CL_TEXT = $00341B10;    // #101B34
  CL_MUTED = $008B7464;   // #64748B
  CL_FAINT = $00B8A294;   // #94A2B8
  CL_ACCENT = $00EB6325;  // #2563EB

var
  BgImage, IconImage, InputBoxImg, BarTrack, BarFill, Rocket: TBitmapImage;
  Slides: array[0..3] of TBitmapImage;
  RocketA, RocketB: TBitmap;
  CloseLabel, TitleLabel, VerLabel, Headline, PhaseLabel, PctLabel: TLabel;
  Foot1, Foot2, CustomLink, PathValue: TLabel;
  BigButton: TBitmapImage;
  BigCap: TLabel;
  GhostButton: TBitmapImage;
  GhostCap: TLabel;
  BrowseButton: TBitmapImage;
  BrowseCap: TLabel;
  TimerID, SlideTimerID: Longword;
  FrameFlip, Installing, Done, SkipDir: Boolean;
  Pct, SlideIndex: Integer;
  Phase: String;

{ ------------------------------------------------------------------ Win32 }

function SetTimer(hWnd, nIDEvent, uElapse, lpTimerFunc: Longword): Longword;
  external 'SetTimer@user32.dll stdcall';
function KillTimer(hWnd, nIDEvent: Longword): Boolean;
  external 'KillTimer@user32.dll stdcall';
function CreateRoundRectRgn(x1, y1, x2, y2, w, h: Integer): Longword;
  external 'CreateRoundRectRgn@gdi32.dll stdcall';
function SetWindowRgn(hWnd: HWND; hRgn: Longword; bRedraw: Boolean): Integer;
  external 'SetWindowRgn@user32.dll stdcall';
function GetSystemMetrics(nIndex: Integer): Integer;
  external 'GetSystemMetrics@user32.dll stdcall';
function SendMessage(hWnd: HWND; Msg, wParam, lParam: Longint): Longint;
  external 'SendMessageW@user32.dll stdcall';
function GetWindowLong(hWnd: HWND; nIndex: Integer): Longint;
  external 'GetWindowLongW@user32.dll stdcall';
function SetWindowLong(hWnd: HWND; nIndex, dwNewLong: Longint): Longint;
  external 'SetWindowLongW@user32.dll stdcall';
function SetWindowPos(hWnd, hWndInsertAfter: HWND; X, Y, cx, cy: Integer;
  uFlags: Longword): Boolean;
  external 'SetWindowPos@user32.dll stdcall';

{ ------------------------------------------------------------------ 工具 }

procedure FitWindow; forward;
procedure OnCloseClick(Sender: TObject); forward;
procedure OnBigClick(Sender: TObject); forward;
procedure OnGhostClick(Sender: TObject); forward;
procedure OnCustomClick(Sender: TObject); forward;
procedure OnBrowseClick(Sender: TObject); forward;

function Tx(v: Integer): Integer;
begin
  Result := ScaleX(v);
end;

function Ty(v: Integer): Integer;
begin
  Result := ScaleY(v);
end;

{ Inno 没公开"翻页"方法，但 NextButton/BackButton 是真 Win32 按钮，
  发 BM_CLICK 等价于用户点击（完成页上 NextButton 就是「完成」）。 }
procedure ClickWizardButton(h: HWND);
begin
  SendMessage(h, BM_CLICK, 0, 0);
end;

procedure StyleLabel(l: TLabel; color: TColor; size: Integer; bold: Boolean);
begin
  l.Font.Color := color;
  l.Font.Size := size;
  l.Font.Name := 'Microsoft YaHei';
  if bold then
    l.Font.Style := [fsBold]
  else
    l.Font.Style := [];
end;

procedure LoadPng(img: TBitmapImage; const name: String);
begin
  img.PngImage.LoadFromFile(ExpandConstant('{tmp}\') + name);
end;

function AddImage(paren: TWinControl; left, top, w, h: Integer;
  const name: String; stretch: Boolean): TBitmapImage;
begin
  Result := TBitmapImage.Create(WizardForm);
  Result.Parent := paren;
  Result.Left := Tx(left);
  Result.Top := Ty(top);
  Result.Width := Tx(w);
  Result.Height := Ty(h);
  Result.Stretch := stretch;
  Result.BackColor := clNone;
  LoadPng(Result, name);
end;

function AddLabel(paren: TWinControl; left, top: Integer; const caption: String;
  color: TColor; size: Integer; bold: Boolean): TLabel;
begin
  Result := TLabel.Create(WizardForm);
  Result.Parent := paren;
  Result.Left := Tx(left);
  Result.Top := Ty(top);
  Result.Caption := caption;
  StyleLabel(Result, color, size, bold);
end;

procedure MakeButton(var b: TBitmapImage; var cap: TLabel; left, top, w, h: Integer;
  const caption: String; const asset: String; onClick: TNotifyEvent);
begin
  { 用 TBitmapImage 而不是 TBitmapButton：后者不会缩放位图，在高 DPI 下按钮
    会比版面小一圈、位置也对不上。TBitmapImage 有 Stretch，可以跟着 ScaleX 走。 }
  b := AddImage(WizardForm, left, top, w, h, asset, True);
  b.Cursor := crHand;
  b.OnClick := onClick;

  cap := TLabel.Create(WizardForm);
  cap.Parent := WizardForm;
  cap.Left := Tx(left);
  cap.Width := Tx(w);
  cap.AutoSize := False;
  cap.Height := Ty(22);
  cap.Top := Ty(top) + (Ty(h) - Ty(22)) div 2;
  cap.Alignment := taCenter;
  cap.Cursor := crHand;
  cap.Caption := caption;
  cap.OnClick := onClick;
end;


{ -------------------------------------------------------------- 界面搭建 }

procedure BuildUI;
var
  i: Integer;
begin
  BgImage := AddImage(WizardForm, 0, 0, CARD_W, CARD_H, 'bg.png', True);

  IconImage := AddImage(WizardForm, 28, 26, 40, 40, 'icon-44.png', True);

  TitleLabel := AddLabel(WizardForm, 80, 22, '{#AppName}', CL_TEXT, 16, True);
  VerLabel := AddLabel(WizardForm, 81, 56, '版本 {#AppVersion} · {#ArchSlug}', CL_MUTED, 9, False);

  { ✕ 已经烘进背景图，这里只放一个透明命中区域 }
  CloseLabel := AddLabel(WizardForm, 512, 14, '', CL_FAINT, 13, False);
  CloseLabel.Width := Tx(32);
  CloseLabel.Height := Ty(32);
  CloseLabel.Cursor := crHand;
  CloseLabel.OnClick := @OnCloseClick;

  { ---- 页 1：一键安装 ----
    大按钮在 y=112，右侧「自定义安装」，底部两行文案 }
  MakeButton(BigButton, BigCap, 168, 112, BIG_W, BIG_H, '一键安装', 'btn-big.png', @OnBigClick);
  StyleLabel(BigCap, clWhite, 13, True);

  CustomLink := AddLabel(WizardForm, 444, 128, '自定义安装 ›', CL_ACCENT, 9, False);
  CustomLink.Cursor := crHand;
  CustomLink.OnClick := @OnCustomClick;
  CustomLink.Width := Tx(96);

  Foot1 := AddLabel(WizardForm, 28, 208, '安装到  ' + ExpandConstant('{autopf}\{#AppDirName}'), CL_MUTED, 9, False);
  Foot2 := AddLabel(WizardForm, 28, 232, '局域网课堂互动工具 · 不联网、不上传，装完即可开课', CL_FAINT, 9, False);

  { ---- 页 2：自定义安装 ----
     标题 + 路径底板 + 浏览… + 开始安装 + 返回 }
  Headline := AddLabel(WizardForm, 28, 84, '选择安装位置', CL_TEXT, 12, True);

  InputBoxImg := AddImage(WizardForm, 28, 124, 504, 40, 'inputbox.png', True);
  PathValue := AddLabel(WizardForm, 42, 136, '', CL_TEXT, 9, False);

  MakeButton(BrowseButton, BrowseCap, 456, 127, 76, 34, '浏览…', 'btn-browse.png', @OnBrowseClick);
  StyleLabel(BrowseCap, CL_TEXT, 9, False);

  { ---- 页 3：安装中（轮播 + 进度条 + 火箭）---- }
  for i := 0 to 3 do
  begin
    Slides[i] := AddImage(WizardForm, 28, SLIDE_Y, SLIDE_W, SLIDE_H, 'slide-' + IntToStr(i + 1) + '.png', True);
    Slides[i].Visible := False;
  end;

  BarTrack := AddImage(WizardForm, 28, BAR_Y, BAR_W, BAR_H, 'bar_track.png', True);
  BarFill := AddImage(WizardForm, 28, BAR_Y, BAR_W, BAR_H, 'bar_fill.png', True);
  BarFill.Width := 0;

  Rocket := TBitmapImage.Create(WizardForm);
  Rocket.Parent := WizardForm;
  Rocket.Left := Tx(28 - ROCKET_SIZE div 2);
  Rocket.Top := Ty(BAR_Y + BAR_H div 2 - ROCKET_SIZE div 2);
  Rocket.Width := Tx(ROCKET_SIZE);
  Rocket.Height := Ty(ROCKET_SIZE);
  Rocket.Stretch := True;
  Rocket.BackColor := clNone;

  PhaseLabel := AddLabel(WizardForm, 28, 230, '等待开始', CL_MUTED, 9, False);
  PctLabel := AddLabel(WizardForm, 472, 226, '0%', CL_TEXT, 11, True);
  PctLabel.Width := Tx(60);
  PctLabel.Alignment := taRightJustify;

  { ---- 页 4：完成 ----
     大按钮与返回按钮复用下面的 BigButton/GhostButton 位置：y=190 }
  MakeButton(GhostButton, GhostCap, 404, 199, 76, 34, '返回', 'btn-ghost.png', @OnGhostClick);
  StyleLabel(GhostCap, CL_TEXT, 9, False);

  BgImage.SendToBack;
end;

procedure FitWindow;
var
  r: Longword;
begin
  WizardForm.ClientWidth := Tx(CARD_W);
  WizardForm.ClientHeight := Ty(CARD_H);
  WizardForm.Left := (GetSystemMetrics(0) - WizardForm.Width) div 2;
  WizardForm.Top := (GetSystemMetrics(1) - WizardForm.Height) div 2;
  r := CreateRoundRectRgn(0, 0, WizardForm.Width + 1, WizardForm.Height + 1,
                          Tx(28), Ty(28));
  SetWindowRgn(WizardForm.Handle, r, True);
end;

procedure StripWindowChrome;
var
  style: Longint;
begin
  WizardForm.Color := CL_CARD;
  style := GetWindowLong(WizardForm.Handle, GWL_STYLE);
  style := style and not (WS_CAPTION or WS_THICKFRAME or WS_SYSMENU
                          or WS_MINIMIZEBOX or WS_MAXIMIZEBOX);
  SetWindowLong(WizardForm.Handle, GWL_STYLE, style);
  SetWindowPos(WizardForm.Handle, 0, 0, 0, 0, 0,
               SWP_FRAMECHANGED or SWP_NOMOVE or SWP_NOSIZE or SWP_NOZORDER);
  FitWindow;
end;

procedure HideStockControls;
var
  i: Integer;
begin
  WizardForm.OuterNotebook.Visible := False;
  WizardForm.PageNameLabel.Visible := False;
  WizardForm.PageDescriptionLabel.Visible := False;
  WizardForm.BackButton.Visible := False;
  WizardForm.NextButton.Visible := False;
  WizardForm.CancelButton.Visible := False;
  WizardForm.Bevel1.Visible := False;
  { Inno 的底部分隔线叫 FBevel，没有公开属性，只能按名字找出来藏掉 }
  for i := 0 to WizardForm.ControlCount - 1 do
    if (WizardForm.Controls[i].Name = 'FBevel') or (WizardForm.Controls[i].Name = 'FBeveledLabel') then
      WizardForm.Controls[i].Visible := False;
end;

{ -------------------------------------------------------------- 页面状态 }

procedure SetPage(page: Integer);
begin
  { 1 = 欢迎 / 2 = 自定义目录 / 3 = 安装中 / 4 = 完成 }
  TitleLabel.Visible := True;
  VerLabel.Visible := True;
  IconImage.Visible := True;
  CloseLabel.Visible := True;

  CustomLink.Visible := page = 1;
  Foot1.Visible := (page = 1) or (page = 4);
  Foot2.Visible := page = 1;

  InputBoxImg.Visible := page = 2;
  PathValue.Visible := page = 2;
  BrowseButton.Visible := page = 2;
  BrowseCap.Visible := page = 2;

  Slides[0].Visible := False;
  Slides[1].Visible := False;
  Slides[2].Visible := False;
  Slides[3].Visible := False;
  BarTrack.Visible := page = 3;
  BarFill.Visible := page = 3;
  Rocket.Visible := page = 3;
  PhaseLabel.Visible := page = 3;
  PctLabel.Visible := page = 3;

  Headline.Visible := page >= 2;

  BigButton.Visible := page = 1;
  BigCap.Visible := page = 1;
  GhostButton.Visible := (page = 2) or (page = 4);
  GhostCap.Visible := (page = 2) or (page = 4);
end;

procedure UpdateProgress(p: Integer);
var
  w: Integer;
begin
  if p < 0 then p := 0;
  if p > 100 then p := 100;
  Pct := p;
  w := (Tx(BAR_W) * p) div 100;
  BarFill.Width := w;
  Rocket.Left := Tx(28) + w - Tx(ROCKET_SIZE) div 2;
  PctLabel.Caption := IntToStr(p) + '%';
  PhaseLabel.Caption := Phase;
end;

{ -------------------------------------------------------------- 交互逻辑 }

procedure OnBigClick(Sender: TObject);
begin
  SkipDir := True;                                    { 一键安装：跳过目录页 }
  ClickWizardButton(WizardForm.NextButton.Handle);
end;

procedure OnCustomClick(Sender: TObject);
begin
  SkipDir := False;                                   { 自定义安装：显示目录页 }
  ClickWizardButton(WizardForm.NextButton.Handle);
end;

procedure OnGhostClick(Sender: TObject);
begin
  if Done then
  begin
    WizardForm.Close;
    Exit;
  end;
  { 回到欢迎页 }
  ClickWizardButton(WizardForm.BackButton.Handle);
end;


procedure OnBrowseClick(Sender: TObject);
begin
  SendMessage(WizardForm.DirBrowseButton.Handle, BM_CLICK, 0, 0);
  PathValue.Caption := WizardForm.DirEdit.Text;
end;

procedure OnCloseClick(Sender: TObject);
begin
  if Installing and not Done then
    Exit;              { 安装中不允许直接退出，避免装一半 }
  WizardForm.Close;
end;

procedure OnTimer(hWnd, uMsg, idEvent, dwTime: Longword);
begin
  if (idEvent = 1) and Rocket.Visible then
  begin
    FrameFlip := not FrameFlip;
    if FrameFlip then
      Rocket.Bitmap := RocketA
    else
      Rocket.Bitmap := RocketB;
  end;
end;



procedure OnSlideTimer(hWnd, uMsg, idEvent, dwTime: Longword);
var
  i: Integer;
begin
  if not Installing then
    Exit;
  for i := 0 to 3 do
    Slides[i].Visible := False;
  SlideIndex := (SlideIndex + 1) mod 4;
  Slides[SlideIndex].Visible := True;
end;

{ ------------------------------------------------------------ Inno 事件 }

procedure InitializeWizard;
begin
  StripWindowChrome;
  HideStockControls;

  ExtractTemporaryFile('bg.png');
  ExtractTemporaryFile('icon-44.png');
  ExtractTemporaryFile('btn-big.png');
  ExtractTemporaryFile('btn-big2.png');
  ExtractTemporaryFile('btn-ghost.png');
  ExtractTemporaryFile('btn-browse.png');
  ExtractTemporaryFile('inputbox.png');
  ExtractTemporaryFile('bar_track.png');
  ExtractTemporaryFile('bar_fill.png');
  ExtractTemporaryFile('slide-1.png');
  ExtractTemporaryFile('slide-2.png');
  ExtractTemporaryFile('slide-3.png');
  ExtractTemporaryFile('slide-4.png');
  ExtractTemporaryFile('rocket-a.bmp');
  ExtractTemporaryFile('rocket-b.bmp');

  { 火箭：32 位 BMP + afDefined 才有透明 }
  RocketA := TBitmap.Create;
  RocketA.AlphaFormat := afDefined;
  RocketA.LoadFromFile(ExpandConstant('{tmp}\rocket-a.bmp'));
  RocketB := TBitmap.Create;
  RocketB.AlphaFormat := afDefined;
  RocketB.LoadFromFile(ExpandConstant('{tmp}\rocket-b.bmp'));

  BuildUI;

  Rocket.Bitmap := RocketA;
  SetPage(1);
  SkipDir := True;

  TimerID := SetTimer(0, 1, 110, CreateCallback(@OnTimer));
  SlideTimerID := SetTimer(0, 2, 3200, CreateCallback(@OnSlideTimer));
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := (PageID = wpSelectDir) and SkipDir;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  FitWindow;
  HideStockControls;   { Inno 会在翻页时把这些按钮重新显示出来，必须每页再藏一次 }

  if CurPageID = wpWelcome then
  begin
    SetPage(1);
    Foot1.Top := Ty(208);
    Headline.Visible := False;
    BigButton.PngImage.LoadFromFile(ExpandConstant('{tmp}\btn-big.png'));
    BigCap.Caption := '一键安装';
    Headline.Caption := '';
  end;

  if CurPageID = wpSelectDir then
  begin
    SetPage(2);
    BigButton.Visible := True;
    BigCap.Visible := True;
    BigButton.Left := Tx(168);
    BigButton.Top := Ty(190);
    BigCap.Left := Tx(168);
    BigCap.Top := Ty(190 + (BIG_H - 18) div 2);
    BigButton.PngImage.LoadFromFile(ExpandConstant('{tmp}\btn-big2.png'));
    BigCap.Caption := '开始安装';
    GhostCap.Caption := '返回';
    Headline.Caption := '选择安装位置';
    if WizardForm.DirEdit.Text = '' then
      PathValue.Caption := ExpandConstant('{autopf}\{#AppDirName}')
    else
      PathValue.Caption := WizardForm.DirEdit.Text;
  end;

  if CurPageID = wpInstalling then
  begin
    Installing := True;
    SetPage(3);
    Phase := '正在解压应用文件…';
    SlideIndex := 0;
    Slides[0].Visible := True;
    UpdateProgress(0);
  end;

  if CurPageID = wpFinished then
  begin
    Done := True;
    Installing := False;
    SetPage(4);
    Headline.Caption := '安装完成，随时可以开课';
    Foot1.Caption := '已安装到  ' + ExpandConstant('{app}');
    Foot1.Top := Ty(124);
    BigButton.Visible := True;
    BigCap.Visible := True;
    BigButton.Left := Tx(168);
    BigButton.Top := Ty(190);
    BigCap.Left := Tx(168);
    BigCap.Top := Ty(190 + (BIG_H - 18) div 2);
    BigButton.PngImage.LoadFromFile(ExpandConstant('{tmp}\btn-big2.png'));
    BigCap.Caption := '完成安装';
    GhostCap.Caption := '关闭';
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  HideStockControls;
  if CurStep = ssInstall then
    Phase := '正在解压应用文件…';
  if CurStep = ssPostInstall then
    Phase := '正在创建快捷方式…';
  if CurStep = ssDone then
    Phase := '安装完成';
end;

procedure CurInstallProgressChanged(CurProgress, MaxProgress: Integer);
begin
  if MaxProgress <= 0 then
    Exit;
  UpdateProgress((CurProgress * 100) div MaxProgress);
end;


procedure DeinitializeSetup;
begin
  if TimerID <> 0 then
    KillTimer(0, TimerID);
  if SlideTimerID <> 0 then
    KillTimer(0, SlideTimerID);
end;
