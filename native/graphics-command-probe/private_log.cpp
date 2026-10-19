#include "private_log.hpp"
#include "bounded_jsonl.hpp"

#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <shlobj.h>

#include <string>
#include <vector>

namespace bc::command_probe {
namespace {

class Handle {
 public:
  explicit Handle(HANDLE value = INVALID_HANDLE_VALUE) : value_(value) {}
  ~Handle() { if (value_ && value_ != INVALID_HANDLE_VALUE) CloseHandle(value_); }
  Handle(const Handle&) = delete;
  Handle& operator=(const Handle&) = delete;
  HANDLE Get() const { return value_; }
 private:
  HANDLE value_;
};

class LocalAllocation {
 public:
  ~LocalAllocation() { if (value) LocalFree(value); }
  void* value = nullptr;
};

class KnownFolderPath {
 public:
  ~KnownFolderPath() { CoTaskMemFree(value); }
  PWSTR value = nullptr;
};

DWORD ProtectHandle(HANDLE handle, PACL dacl) {
  return SetSecurityInfo(handle, SE_FILE_OBJECT,
      DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
      nullptr, nullptr, dacl, nullptr);
}

DWORD Write(std::string_view contents) {
  if (contents.size() > kMaxLogBytes) return ERROR_FILE_TOO_LARGE;

  HANDLE tokenValue = nullptr;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &tokenValue)) return GetLastError();
  Handle token(tokenValue);
  DWORD tokenBytes = 0;
  GetTokenInformation(token.Get(), TokenUser, nullptr, 0, &tokenBytes);
  if (!tokenBytes || tokenBytes > 64 * 1024) return ERROR_INVALID_DATA;
  std::vector<unsigned char> tokenStorage(tokenBytes);
  if (!GetTokenInformation(token.Get(), TokenUser, tokenStorage.data(), tokenBytes, &tokenBytes)) return GetLastError();
  auto* tokenUser = reinterpret_cast<TOKEN_USER*>(tokenStorage.data());
  LocalAllocation sid;
  if (!ConvertSidToStringSidW(tokenUser->User.Sid, reinterpret_cast<LPWSTR*>(&sid.value))) return GetLastError();

  // A protected DACL grants only this user and SYSTEM access, including new files.
  const std::wstring sddl = L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" +
      std::wstring(static_cast<wchar_t*>(sid.value)) + L")";
  LocalAllocation securityDescriptor;
  if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1,
      &securityDescriptor.value, nullptr)) return GetLastError();
  BOOL daclPresent = FALSE;
  BOOL daclDefaulted = FALSE;
  PACL dacl = nullptr;
  if (!GetSecurityDescriptorDacl(securityDescriptor.value, &daclPresent, &dacl, &daclDefaulted) ||
      !daclPresent || !dacl) return ERROR_INVALID_SECURITY_DESCR;
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), securityDescriptor.value, FALSE};

  KnownFolderPath localAppData;
  const HRESULT folderResult = SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_DEFAULT, nullptr, &localAppData.value);
  if (FAILED(folderResult) || !localAppData.value) return ERROR_PATH_NOT_FOUND;
  const std::wstring directory = std::wstring(localAppData.value) + L"\\BetterCaptionsCommandProbe";
  if (!CreateDirectoryW(directory.c_str(), &attributes) && GetLastError() != ERROR_ALREADY_EXISTS) return GetLastError();

  // Refuse a redirected leaf directory and keep it locked against replacement.
  Handle folder(CreateFileW(directory.c_str(), READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ | FILE_SHARE_WRITE, &attributes, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (folder.Get() == INVALID_HANDLE_VALUE) return GetLastError();
  BY_HANDLE_FILE_INFORMATION directoryInfo{};
  if (!GetFileInformationByHandle(folder.Get(), &directoryInfo)) return GetLastError();
  if (!(directoryInfo.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) ||
      (directoryInfo.dwFileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) return ERROR_ACCESS_DENIED;
  const DWORD folderSecurity = ProtectHandle(folder.Get(), dacl);
  if (folderSecurity != ERROR_SUCCESS) return folderSecurity;

  const std::wstring filename = directory + L"\\commands.jsonl";
  Handle file(CreateFileW(filename.c_str(), GENERIC_WRITE | READ_CONTROL | WRITE_DAC | FILE_READ_ATTRIBUTES,
      FILE_SHARE_READ, &attributes, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (file.Get() == INVALID_HANDLE_VALUE) return GetLastError();
  BY_HANDLE_FILE_INFORMATION fileInfo{};
  if (!GetFileInformationByHandle(file.Get(), &fileInfo)) return GetLastError();
  if ((fileInfo.dwFileAttributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_REPARSE_POINT)) ||
      fileInfo.nNumberOfLinks != 1) return ERROR_ACCESS_DENIED;
  const DWORD fileSecurity = ProtectHandle(file.Get(), dacl);
  if (fileSecurity != ERROR_SUCCESS) return fileSecurity;
  LARGE_INTEGER start{};
  if (!SetFilePointerEx(file.Get(), start, nullptr, FILE_BEGIN) || !SetEndOfFile(file.Get())) return GetLastError();
  std::size_t written = 0;
  while (written < contents.size()) {
    DWORD chunkWritten = 0;
    const DWORD chunkBytes = static_cast<DWORD>(contents.size() - written);
    if (!WriteFile(file.Get(), contents.data() + written, chunkBytes, &chunkWritten, nullptr)) return GetLastError();
    if (!chunkWritten) return ERROR_WRITE_FAULT;
    written += chunkWritten;
  }
  return ERROR_SUCCESS;
}

}  // namespace

unsigned long WritePrivateLog(std::string_view contents) noexcept {
  try {
    return Write(contents);
  } catch (...) {
    return ERROR_NOT_ENOUGH_MEMORY;
  }
}

}  // namespace bc::command_probe
