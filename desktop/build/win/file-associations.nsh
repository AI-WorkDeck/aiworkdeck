; SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
; SPDX-License-Identifier: AGPL-3.0-or-later
; Register candidates only. electron-builder 24's APP_ASSOCIATE macro overwrites the
; extension default; Windows UserChoice and existing extension defaults belong to the user.
; https://learn.microsoft.com/windows/win32/shell/how-to-include-an-application-on-the-open-with-dialog-box
!define AWD_FILE_PROGID "com.aiworkdeck.desktop.Document"
!define AWD_FILE_CAPABILITIES "Software\AI WorkDeck\Capabilities"

!macro AwdFileType EXT MODE
  !if "${MODE}" == "install"
    WriteRegStr HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${AWD_FILE_PROGID}" ""
    WriteRegStr HKCU "Software\Classes\Applications\${PRODUCT_FILENAME}.exe\SupportedTypes" ".${EXT}" ""
    WriteRegStr HKCU "${AWD_FILE_CAPABILITIES}\FileAssociations" ".${EXT}" "${AWD_FILE_PROGID}"
  !else
    DeleteRegValue HKCU "Software\Classes\.${EXT}\OpenWithProgids" "${AWD_FILE_PROGID}"
    DeleteRegKey /ifempty HKCU "Software\Classes\.${EXT}\OpenWithProgids"
  !endif
!macroend

!macro AwdFileTypes MODE
  !insertmacro AwdFileType "doc" "${MODE}"
  !insertmacro AwdFileType "docx" "${MODE}"
  !insertmacro AwdFileType "xls" "${MODE}"
  !insertmacro AwdFileType "xlsx" "${MODE}"
  !insertmacro AwdFileType "ppt" "${MODE}"
  !insertmacro AwdFileType "pptx" "${MODE}"
  !insertmacro AwdFileType "pdf" "${MODE}"
  !insertmacro AwdFileType "txt" "${MODE}"
  !insertmacro AwdFileType "md" "${MODE}"
  !insertmacro AwdFileType "markdown" "${MODE}"
  !insertmacro AwdFileType "jpg" "${MODE}"
  !insertmacro AwdFileType "jpeg" "${MODE}"
  !insertmacro AwdFileType "png" "${MODE}"
  !insertmacro AwdFileType "gif" "${MODE}"
  !insertmacro AwdFileType "bmp" "${MODE}"
  !insertmacro AwdFileType "svg" "${MODE}"
  !insertmacro AwdFileType "webp" "${MODE}"
!macroend

!macro AwdRegisterFileAssociations
  WriteRegStr HKCU "Software\Classes\${AWD_FILE_PROGID}" "" "AI WorkDeck Document"
  WriteRegStr HKCU "Software\Classes\${AWD_FILE_PROGID}\DefaultIcon" "" '$\"$INSTDIR\${PRODUCT_FILENAME}.exe$\",0'
  WriteRegStr HKCU "Software\Classes\${AWD_FILE_PROGID}\shell\open\command" "" '$\"$INSTDIR\${PRODUCT_FILENAME}.exe$\" $\"%1$\"'
  WriteRegStr HKCU "Software\Classes\Applications\${PRODUCT_FILENAME}.exe" "FriendlyAppName" "AI WorkDeck"
  WriteRegStr HKCU "Software\Classes\Applications\${PRODUCT_FILENAME}.exe\shell\open\command" "" '$\"$INSTDIR\${PRODUCT_FILENAME}.exe$\" $\"%1$\"'
  WriteRegStr HKCU "${AWD_FILE_CAPABILITIES}" "ApplicationName" "AI WorkDeck"
  WriteRegStr HKCU "${AWD_FILE_CAPABILITIES}" "ApplicationDescription" "Open documents with AI WorkDeck"
  WriteRegStr HKCU "Software\RegisteredApplications" "AI WorkDeck" "${AWD_FILE_CAPABILITIES}"
  !insertmacro AwdFileTypes "install"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro AwdUnregisterFileAssociations
  !insertmacro AwdFileTypes "uninstall"
  DeleteRegKey HKCU "Software\Classes\${AWD_FILE_PROGID}"
  DeleteRegKey HKCU "Software\Classes\Applications\${PRODUCT_FILENAME}.exe"
  DeleteRegKey HKCU "${AWD_FILE_CAPABILITIES}"
  DeleteRegValue HKCU "Software\RegisteredApplications" "AI WorkDeck"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
